# relay-tutorial
Learn how Relay works by writing your own

## Environment
An environment for a GraphQL client like Relay or Apollo contains two parts, the network layer and the cache. 

```javascript
class Environment {
	constructor({networkLayer}) {
		this.networkLayer = networkLayer
		this.cache = {};
	}
}
```
First lets write the network layer.

## Network Layer
A network layer is the function you write to make GraphQL requests. It is usually a simple function that makes a network request to your GraphQL server. We can use the one from Relay's docs and add it to our environment.

```javascript
async function networkLayer(query) {
  const response = await fetch('/graphql', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({query})
  });
  return await response.json();
}

const environment = new Environmment({networkLayer});

```

## fetchQuery
Relay includes a simple function called `fetchQuery` that lets you imperatively make GraphQL queries. First we'll add a method to the environment to send GraphQL queries, then write the fetchQuery function.

```javascript
class Environment {
	constructor({networkLayer}) {
		this.networkLayer = networkLayer
		this.cache = {};
	}
+	async sendQuery(query) {
+	   const result = await this.networkLayer(query);
+	   return result;
+	}
}

+function fetchQuery(environment, query) {
+	return environment.sendQuery(query);
+}
```

What's missing: handling errors from the GraphQL server.

## Publish to cache
The main benefit of using GraphQL is that client code can specify the exact needed data requirements. This means that different queries can contain overlapping data. Sending a mutation that modifies one record should cause any views rendering that same record to be updated. To accomplish this we will want to store all of the data we receive from our GraphQL server in our environment's cache. [SWAPI GraphQL query](http://graphql.org/swapi-graphql/?query=%7B%0A%20%20person(id%3A%20%22cGVvcGxlOjEz%22)%20%7B%0A%20%20%20%20name%0A%20%20%20%20height%0A%20%20%20%20species%20%7B%0A%20%20%20%20%20%20id%0A%20%20%20%20%20%20name%0A%20%20%20%20%20%20homeworld%20%7B%0A%20%20%20%20%20%20%20%20id%0A%20%20%20%20%20%20%20%20name%0A%20%20%20%20%20%20%7D%0A%20%20%20%20%7D%0A%20%20%7D%0A%7D)

**Query**

```GraphQL
{
  person(id: "cGVvcGxlOjEz") {
    id
    name
    height
    species {
      id
      name
      homeworld {
        id
        name
      }
    }
  }
}
```

**Response**

```json
{
  "data": {
    "person": {
      "id": "cGVvcGxlOjEz",
      "name": "Chewbacca",
      "height": 228,
      "species": {
        "id": "c3BlY2llczoz",
        "name": "Wookie",
        "homeworld": {
          "id": "cGxhbmV0czoxNA==",
          "name": "Kashyyyk"
        }
      }
    }
  }
}
```

**Transformed Result**
Start at the root with 'client:root'. Scalar fields are stored directly. Object fields are flattened and use __ref to point to the location in the cache.

```javascript
{
	'client:root': { // root get's assigned id of "client:root"
		// field arguments are stringified and encoded in field name
		'person{"id":"cGVvcGxlOjEz"}': {
			__ref: "cGVvcGxlOjEz" // pointer to nested object 
		},
	},
	'cGVvcGxlOjEz': {
		'id': 'cGVvcGxlOjEz',
		'name': 'Chewbacca',
		'height': 228,
		'species': { __ref: 'c3BlY2llczoz' }
	},
	'c3BlY2llczoz': {
		'id': 'c3BlY2llczoz',
		'name': 'Wookie',
		'homeworld': { __ref: 'cGxhbmV0czoxNA==' }
	},
	'cGxhbmV0czoxNA==': {
		'id': 'cGxhbmV0czoxNA==',
		'name': 'Kashyyyk'
	}
}
```


To get to this, we'll need the Abstract Syntax Tree (AST) of the GraphQL query, which looks like this:

```javascript
{
	definitions: [{
		operation: "query",
		selectionSet:	 {
			selections: [{
				name: "person"
				arguments: [{
					name: { value: "id" },
					value: { value: "cGVvcGxlOjEz" }
				}],
				selectionSet: {
					selections: [
						{ name: { value: "id" } },
						{ name: { value: "name" } },
						{ name: { value: "name" } },
						{ name: { value: "height" } },
						{
							name: { value: "species" },
							selectionSet: {
								selections: [
									{ name: { value: "id" } },
									{ name: { value: "name" } },
									{
										name: { value: "species" },
										selectionSet: {
											selections: [
												{ name: { value: "id" } },
												{ name: { value: "name" } }
											]
										}
									}
								]
							}
						]	
					}
				]
			}]
		}
	}]
}
```

I have omitted some of the fields that we don't need for this example. If you have never worked with ASTs before, it is just an object that describes code.  See astexplorer.net to learn more. You can write or copy/paste code and easily see the AST.

Now we write the recursive function to transform the query and its results into an object for our cache:

```javascript
function getStorageKey(field) {
    let storageKey = field.name.value;
    if (field.arguments.length) {
        storageKey += "{";
        storageKey += field.arguments
            .map(arg => `"${arg.name.value}":"${arg.value.value}"`)
            .join(',');
        storageKey += "}";
    }
    return storageKey;
}

function flattenField(field, result, id, cache = {}) {
    cache[id] = {};
    for (const selection of field.selectionSet.selections) {
        const selectionStorageKey = getStorageKey(selection);
        if (selection.selectionSet) {
            // add link ref
            const selectionData = result[selection.name.value];
            cache[id][selectionStorageKey] = {
                __ref: selectionData.id
            };
            flattenField(selection, selectionData, selectionData.id, cache);
        } else {
            // add scalar value
            cache[id][selectionStorageKey] = result[selection.name.value];
        }
    }
    return cache;
}

function flatten(query, result) {
    const ast = graphql.parse(query);
    return flattenField(ast.definitions[0], result.data, 'client:root');
}
```

And now on every request we will add the new data to the cache:

```javascript
class Environment {
	constructor({networkLayer}) {
		this.networkLayer = networkLayer
		this.cache = {};
	}
	async sendQuery(query) {
	   const result = await this.networkLayer(query);
	   this.publish(result);
	   return result;
	}
	publish(result) {
+	   Object.assign(this.cache, flatten(query, result))
	}
}
```

What's missing: Handling queries with variables, handling field aliases, handling array (plural) field links, automatically add `id` field to each object.

## QueryRenderer
Now we can add the first React Component, the QueryRenderer. You use it by passing an environment instance, a graphql query, and a [render prop](https://cdb.reacttraining.com/use-a-render-prop-50de598f11ce) that is called with the data from the GraphQL server.

```javascript
const MyComponent = () => (
	<QueryRenderer
		environment={environment}
		query={`
			{
			  person(id: "cGVvcGxlOjEz") {
			    id
			    name
			    height
			    species {
			      id
			      name
			      homeworld {
			        id
			        name
			      }
			    }
			  }
			}
		`}
		render={({props}) => {
			if (!props) {
				return <div>Loading</div>;
			}
			return (
				<div>
					<h1>{props.person.name}</h1>
					<div>height: {props.person.height}</div>
					<div>species: {props.person.species.name}</div>
					<div>homeworld: {props.person.species.homeworld.name}</div>
				</div>
			);
		}}
	/>
)

```

Now lets implement it

```javascript
class QueryRenderer extends React.Component {
	async constructor(props) {
		super(props);
		this.state = {};
		const data = await props.environment.sendQuery(props.query);
		this.setState({props: data});
	}
	render() {
		return this.props.render({this.state});
	}
}
```
What's missing: Re-fetch when query or environment props changes.

## Data masking & selectors
One of the main features of Relay is fragment colocation and data masking. You keep GraphQL fragments in the same file as your component and each component only has access to the data specified in that fragment. It does not have access to any data requested by parent, child, or sibling containers. This is done to prevent implicit dependencies. You don't want to accidently rely on data that was requested by an unrelated component. [Read more about data masking.](https://facebook.github.io/relay/docs/thinking-in-relay.html#data-masking)

To accomplish this we need a way to pull data out of the store based on the fragments. We will use fragments to create "selectors" for this purpose.

First let's break up our query into fragments

```graphql
{
  person(id: "cGVvcGxlOjEz") {
  	...PersonDetails
    id
  }
}

fragment PersonDetails on Person {
	id
	name,
	height
	species {
		id
		...SpeciesDetails
	}
}

fragment SpeciesDetails on Species {
	id
   name
   homeworld {
     id
     name
   }
}

```

And now a function to select data for a fragment out of the store. We need both the fragment and the id of the object we are selecting.

```javascript
class Environment {
	...
	_traverseSelections(record, selections) {
        const data = {};
        for (const selection of selections) {
            const selectionResult = record[selection.name.value];
            if (typeof selectionResult === 'object' && selectionResult.__ref) {
                // link to another object
                data[selection.name.value] = this._traverseSelections(
                    this.cache[selectionResult.__ref],
                    selection.selectionSet.selections
                );
            } else if (selection.kind === 'FragmentSpread') {
                // reference another fragment
                data.__fragments = data.__fragments || {};
                data.__fragments[selection.name.value] = {};
            } else {
                // scalar
                data[selection.name.value] = selectionResult;
            }
        }
        return data;
    }
    selectData(id, definition) {
    	 // definition is either fragment or query AST
        return this._traverseSelections(
            this.cache[id],
            definition.selectionSet.selections
        );
    }
}
```
What's missing: handling variables (again), array fields (again)

## Fragment Container

A fragment container is a Higher Order Component that enables data masking and GraphQL fragment co-location. I'm going to rewrite the example the QueryRenderer example to use Fragment Containers

```javascript
const MyComponent = () => (
	<QueryRenderer
		environment={environment}
		query={`
		  {
			  person(id: "cGVvcGxlOjEz") {
			  	...PersonDetails
			    id
			  }
			}
		`}
		render={({props}) => {
			if (!props) {
				return <div>Loading</div>;
			}
			return (
				<PersonDetails data={props.person}/>
			);
		}}
	/>
)

let PersonDetails = ({data}) => (
	<div>
		<h1>{props.person.name}</h1>
		<div>height: {props.person.height}</div>
		<SpeciesDetails data={data.species} />
	</div>	
);

PersonDetails = createFragmentContainer(PersonDetails, `
	fragment PersonDetails on Person {
		id
		name,
		height
		species {
			id
			...SpeciesDetails
		}
	}
`);

let SpeciesDetails = ({data}) => (
	<div>
		<div>species: {data.name}</div>
		<div>homeworld: {data.homeworld.name}</div>
	</div>	
);

SpeciesDetails = createFragmentContainer(SpeciesDetails, `
	fragment SpeciesDetails on Person {
		id
	   name
	   homeworld {
	     id
	     name
	   }
	}
`);

```

First we'll update the QueryRenderer to use selectData for proper data masking. We also add the environment to React context

```javascript
class QueryRenderer extends React.Component {
	async constructor(props) {
		super(props);
		this.state = {};
		await props.environment.sendQuery(props.query);
		const definition = graphql.parse(query).definitions[0];
		const data = props.environment.selectData('client:root', definition);
		this.setState({props: data});
	}
	getChildContext() {
		return {
			environment: this.props.environment
		};
	}
	render() {
		return this.props.render({this.state});
	}
}
```

And now implement `createFragmentContainer`

```javascript
const createFragmentContainer = (Component, fragment) => {
	return class extends React.Component {
		constructor(props) {
			super(props);
			const definition = graphql.parse(fragment).definitions[0];
			this.state = {
				data: this.context.environment.selectData(
					props.data.id,
					definition
				)
			};
		}
		render() {
			return <Component data={this.state.data} />;
		}
	}
}
```
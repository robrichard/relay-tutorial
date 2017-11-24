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
            console.log(selection);
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
+	   Object.assign(this.cache, flatten(query, result))
	   return result;
	}
}
```

What's missing: Handling queries with variables, handling field aliases, handling array (plural) field links.

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
	constructor(props) {
		super(props);
		this.state = {};
		props.environment.sendQuery(props.query)
			.then(data => this.setState({props: data}));
	}
	render() {
		return this.props.render({this.state});
	}
}
```
What's missing: Re-fetch when query or environment props changes.
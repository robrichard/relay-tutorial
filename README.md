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
async function networkLayer(
  query,
  variables
) {
  const response = await fetch('/graphql', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({query, variables})
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
+	async sendQuery(query, variables) {
+	   const data = await this.networkLayer(query, variables);
+	   return data;
+	}
}

+function fetchQuery(environment, query, variables) {
+	return environment.sendQuery(query, variables);
+}
```

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
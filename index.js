const graphql = require('graphql');

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
        Object.assign(this.cache, flatten(query, result))
    }
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
    selectData(id, fragment) {
        const fragmentAst = graphql.parse(fragment);
        console.log(JSON.stringify(fragmentAst, null, 2));
        return this._traverseSelections(
            this.cache[id],
            fragmentAst.definitions[0].selectionSet.selections
        );
    }
}


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

const query = `{
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
}`;

const response = {
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
};

// console.log(JSON.stringify(flatten(query, response), null, 2));

const environment = new Environment({});
environment.publish(response);

const fragment = `
    fragment PersonDetails on Person {
        id
        name,
        height
        species {
            id
            ...SpeciesDetails
        }
    }
`;

console.log(environment.selectData(
    "cGVvcGxlOjEz",
    fragment
));
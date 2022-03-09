# postgraphile-plugin-numeral

Adds [numeral.js](http://numeraljs.com/) support to PostGraphile for all `int` fields in the database.

By default the new fields will be named column name + Numeral, for example fileSizeNumeral

![GraphiQL Screenshot](doc/graphiql_screenshot.png)


## Usage

Add PostGraphilePluginNumeral to appendPlugins.

```js
import express from 'express';
import postgraphile from 'postgraphile';
import PostGraphilePluginNumeral from 'postgraphile-plugin-numeral';

const app = express();

app.use(
    postgraphile(
        process.env.DATABASE_URL || 'postgres://user:pass@host:5432/dbname',
        'public',
        {
            appendPlugins:
            [
                PostGraphilePluginNumeral()
            ],
            watchPg: true,
            graphiql: true,
            enhanceGraphiql: true,
        }
    )
);

app.listen(process.env.PORT || 3000);

```

## API
### PostGraphilePluginNumeral([nameFn])

Constructs the plugin with an optional name function. The name function determines how
the numeral fields will be named in the GraphQL schema.

* `nameFn` - `function(name: string): string`, called when a name is generated for the numeral field. The returned
  string is used as the new field's name

## Usage

### RunInMeteorPlugin

```js
var RunInMeteorPlugin = require('webpack-meteor-tools/lib/RunInMeteorPlugin');
```

Create this plugin in your webpack config:
```js
{
  ...
  plugins: [
    ...
    new RunInMeteorPlugin({
      meteor: '/absolute/path/to/meteor/dir',
      key: 'any key',   // assets previously created in the meteor dir by a RunInMeteorPlugin
                        // with the same key will be deleted.  This cleans out leftover assets
                        // from prod mode when launching dev mode, or vice versa.
      target: 'client', // or 'server'
      mode: 'dev'       // or 'prod'
    }),
  ]
}
```

### runWebpackConfigs(configs, callback)

```js
var runWebpackConfigs = require('webpack-meteor-tools/lib/RunInMeteorPlugin');
```

Runs/starts webpack/webpack-dev-server for multiple webpack configs sequentially.

#### Arguments:
* `configs`: an array of webpack configs
* `callback`: node-style callback to call when the webpack/webpack-dev-server instances have
              finished starting up.

Configs containing a `devServer` prop will be run with `webpack-dev-server`.  All other configs
will be run with `webpack` (in watch mode for configs that have `watch: true`).

#### Example:

```js
require('shelljs/global');
var dirs = require('./dirs');
var runWebpackConfigs = require('webpack-meteor-tools/lib/RunInMeteorPlugin');
var configs = require('fs-finder').from(dirs.webpack).findFiles('<.*\.dev.js$>');

runWebpackConfigs(configs, function(err) {
  if (err) throw err;
  cd(dirs.meteor);
  exec('meteor --settings ../settings/devel.json', {async: true});
});
```

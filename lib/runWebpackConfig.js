var webpack = require('webpack');
var StatsPlugin = require('./StatsPlugin');
var addProgressPlugin = require('./addProgressPlugin');

var defaultStats = {
  colors: true,
  chunkModules: false,
  modules: false,
};

module.exports = function(config, callback) {
  if (!callback) callback = function() {};

  var firstRun = true;

  function firstRunCallback(err, stats) {
    if (err) {
      console.error(error);
      return callback(err);
    }
    if (!config.devServer) {
      console.log(stats.toString(defaultStats));
    }
    if (firstRun) {
      firstRun = false;
      callback(err, stats);
    }
  }

  try {
    addProgressPlugin(config);

    if (config.devServer) {
      config.plugins.push(new StatsPlugin(firstRunCallback));
      config.devServer.stats = config.devServer.stats || defaultStats;
    }

    var compiler = webpack(config);

    if (config.devServer) {
      console.log('running dev server...');
      var WebpackDevServer = require('webpack-dev-server');
      new WebpackDevServer(compiler, config.devServer).listen(
        config.devServer.port, config.devServer.host, function() {});
    }
    else {
      if (config.watch) {
        compiler.watch(config.watchOptions || {}, firstRunCallback);
      }
      else {
        compiler.run(firstRunCallback);
      }
    }
  } 
  catch (err) {
    return callback(err);
  }
};
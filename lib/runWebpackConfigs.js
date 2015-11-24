var runWebpackConfig = require('./runWebpackConfig');

module.exports = function(configs, callback) {
  return configs.reduceRight(function(callback, config) {
    return function(err) {
      if (err) return callback(err);
      runWebpackConfig(config, callback);
    };
  }, callback)();
};

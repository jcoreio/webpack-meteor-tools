function StatsPlugin(callback) {
  this.callback = callback;
}

StatsPlugin.prototype.apply = function(compiler) {
  var callback = this.callback;
  compiler.plugin('done', function(stats) {
    callback(undefined, stats);
  });
};

module.exports = StatsPlugin;
var shell = require('shelljs');
var fs = require('fs');
var path = require('path');

module.exports = function(meteorDir) {
  fs.readdirSync(meteorDir).filter(function(file) {
    return /\.webpack-assets.*$/.test(file);
  }).forEach(function(file) {
    var assetFile = path.join(meteorDir, file);
    var assets = JSON.parse(fs.readFileSync(assetFile));
    assets.forEach(function(asset) {
      asset = path.join(meteorDir, asset);
      if (fs.existsSync(asset)) {
        shell.rm('-r', asset);
      }
    });
    shell.rm(assetFile);
  });
};

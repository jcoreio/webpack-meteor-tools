var fs = require('fs');
var path = require('path');
var shell = require('shelljs');
var ConcatSource = require("webpack/lib/ConcatSource");
var util = require('util');
var prependEntry = require('./prependEntry');

function findMeteorDir(childPath) {
  if (!childPath) {
    return;
  }
  if (fs.existsSync(path.join(childPath, '.meteor/packages')) &&
      fs.existsSync(path.join(childPath, '.meteor/platforms')) &&
      fs.existsSync(path.join(childPath, '.meteor/release')) &&
      fs.existsSync(path.join(childPath, '.meteor/versions'))) {
    return childPath;
  }
  var parent = path.dirname(childPath);
  if (parent && parent !== childPath) {
    return findMeteorDir(parent);
  }
}

function RunInMeteorPlugin(options) {
  this.options = options;
  if (!findMeteorDir(options.path)) {
    throw new Error("options.path must be a Meteor directory or a subpath of it");
  }
  if (options.target !== 'client' && options.target !== 'server') {
    throw new Error("options.target must be 'client' or 'server'");
  }
  if (options.mode !== 'development' && options.mode !== 'production') {
    throw new Error("options.mode must be 'development' or 'production'");
  }
  if (!options.key) {
    throw new Error('you must provide options.key');
  }
}

var serverBanner = 'var require = Npm.require;\n';

function createLoadClientBundleHtml(publicPath) {
  return '<head>\n' +
         '  <script type="text/javascript" src="' + publicPath + '"></script>\n' +
         '</head>\n';
  // return  '<head>\n' +
  //         '  <script type="text/javascript">\n' +
  //         "    // unfortunately it's not possible to make a URL relative to the current host with a different port,\n" +
  //         "    // so the URL must be created by script like this if we want to test on devices besides localhost.\n" +
  //         "    var scriptElem = document.createElement('script');\n" +
  //         "    scriptElem.type = 'text/javascript';\n" +
  //         "    scriptElem.src = /https?:\\/\\/[^:\\/]+/.exec(window.location.href)[0] + ':9090/assets/client.bundle.js';\n" +
  //         "    document.head.appendChild(scriptElem);\n" +
  //         "  </script>\n" +
  //         "</head>\n";
}

RunInMeteorPlugin.prototype.apply = function(compiler) {
  var outputDir = this.options.path;
  var meteorDir = findMeteorDir(outputDir);
  var key = this.options.key;
  var target = this.options.target;
  var mode = this.options.mode;
  var chunkNames = this.options.chunkNames;
  var assetsFile = path.join(meteorDir, '.webpack-assets-' + key);

  var sourceMapSupportInstalled = false;

  if (target === 'server') {
    compiler.plugin("compilation", function(compilation) {
      if (mode === 'development' && !sourceMapSupportInstalled) {
        var installSourceMapSupport = path.join(__dirname, 'installSourceMapSupport');
        prependEntry(compilation.options, installSourceMapSupport);
        sourceMapSupportInstalled = true;
      }

      var outputPath = compilation.compiler.outputPath;
      compilation.plugin("optimize-chunk-assets", function(chunks, callback) {
        chunks.forEach(function(chunk) {
          chunk.files.filter(function(file) {
            return /\.js$/.test(file);
          }).forEach(function(file) {
            compilation.assets[file] = new ConcatSource(serverBanner, compilation.assets[file],
              '\n//# useNextSourceMappingURL' +
              '\n//# sourceMappingURL=' + path.join(outputPath, file) + '.map\n');
          });
        });
        callback();
      });
    });
  }

  var hasRun = false;

  compiler.plugin('done', function(stats) {
    var firstTime = !hasRun;
    if (firstTime) {
      hasRun = true;
    }
    else {
      if (target === 'client' && mode === 'development') {
        return;
      }
    }

    // clean out stale prod assets if running in dev mode and vice versa
    if (fs.existsSync(assetsFile)) {
      var staleAssets = JSON.parse(fs.readFileSync(assetsFile));
      staleAssets.forEach(function(asset) {
        asset = path.join(meteorDir, asset);
        if (fs.existsSync(asset)) {
          shell.rm('-r', asset);
        }
      });
    }

    var jsonStats = stats.toJson({
      source: false,
      modules: false,
    });

    var outputAssets = [];

    function addAsset(file) {
      outputAssets.push(path.relative(meteorDir, file));
    }

    function mkdirp(dir) {
      var parent = path.dirname(dir);
      if (!fs.existsSync(parent)) {
        mkdirp(parent);
      }
      addAsset(dir);
      shell.mkdir(dir);
    }

    if (!fs.existsSync(outputDir)) {
      mkdirp(outputDir);
    }

    var assetsToProcess;
    if (chunkNames) {
      var chunkNameMap = {};
      chunkNames.forEach(function(name) {
        chunkNameMap[name] = true;
      });
      assetsToProcess = [];
      for (var chunkName in jsonStats.assetsByChunkName) {
        if (chunkNameMap.hasOwnProperty(chunkName)) {
          assetsToProcess = assetsToProcess.concat(jsonStats.assetsByChunkName[chunkName]);
        }
      }
    }
    else {
      assetsToProcess = jsonStats.assets.map(function(asset) {
        return asset.name;
      });
    }
    assetsToProcess.forEach(function(asset) {
      var assetPath = path.join(compiler.options.output.path, asset);

      function justCopy(target) {
        target = target || path.join(outputDir, asset);
        addAsset(target);
        cp('-f', assetPath, target);
      }

      function writeFile(targetFile, code) {
        addAsset(targetFile);
        fs.writeFileSync(targetFile, code);
      }

      if (!/\.js$/.test(asset) && compiler.options.devServer) {
        return;
      }

      if (!/\.(js|map)$/.test(asset)) {
        return justCopy();
      }

      switch (target) {
        case 'client':
          switch(mode) {
            case 'development':
              var loadClientBundleHtml = createLoadClientBundleHtml(jsonStats.publicPath + asset);
              var targetFile = path.join(outputDir, 'load.' + asset + '.html');
              writeFile(targetFile, loadClientBundleHtml);
              break;
            case 'production':
              if (/\.js$/.test(asset)) {
                return justCopy(path.join(outputDir, asset));
              }
              justCopy();
              break;
          }
          break;
        case 'server':
          switch(mode) {
            case 'development':
              if (/\.map$/.test(asset)) {
                return;
              } 
              justCopy();
              break;
            case 'production':
              if (/\.js$/.test(asset)) {
                return justCopy(path.join(outputDir, asset));
              }
              justCopy();
              break;
          }
          break;
        default:
          justCopy();
          break;
      }
    });

    // log what assets we output to Meteor dir so we can clean them out after next compile
    fs.writeFileSync(assetsFile, JSON.stringify(outputAssets, null, "  "));
  });
};

module.exports = RunInMeteorPlugin;

var fs = require('fs');
var path = require('path');
var shell = require('shelljs');
var ConcatSource = require("webpack/lib/ConcatSource");

function RunInMeteorPlugin(options) {
  this.options = options;
  if (!fs.statSync(options.meteor).isDirectory()) {
    throw new Error("options.meteor must be a directory");
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

var serverDevBanner =  'require("source-map-support/register");\n' +
  // hack these variables into the local scope where they're expected
  // since we need to Npm.require server bundles for dev features
  'var Npm = Meteor.__mwrContext__.Npm;\n' +
  'var Assets = Meteor.__mwrContext__.Assets;\n' +
  'delete Meteor.__mwrContext__;\n' +
  'var require = Npm.require;\n';

// make it possible to use target: 'node' in webpack config
// (require('fs') and other node internals will be left untouched
// by webpack)
var serverProdBanner = 'var require = Npm.require;\n';

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

// rename bundles to .min.js in production so that Meteor won't re-minify bundles
// (well, at least if/when they accept my PR not to re-minify .min.js files)
// and you can control minification in Webpack config instead
// TODO: maybe conditionally enable this when UglifyJSPlugin is found in webpack config?
function renameToMinJs(jsFile) {
  var match = /\.js$/.exec(jsFile);
  if (!match) {
    return jsFile;
  }
  return jsFile.substring(0, match.index) + '.min.js';
}

RunInMeteorPlugin.prototype.apply = function(compiler) {
  var outputDir = this.options.meteor;
  var key = this.options.key;
  var target = this.options.target;
  var mode = this.options.mode;
  var assetsFile = path.join(outputDir, '.webpack-assets-' + key);
  if (this.options.target) {
    outputDir = path.join(outputDir, this.options.target);
  }

  if (target === 'server') {
    var banner;
    switch (mode) {
      case 'development':
        banner = serverDevBanner;
        break;
      case 'production':
        banner = serverProdBanner;
        break;
    }
    if (banner) {
      compiler.plugin("compilation", function(compilation) {
        compilation.plugin("optimize-chunk-assets", function(chunks, callback) {
          chunks.forEach(function(chunk) {
            chunk.files.filter(function(file) {
              return /\.js$/.test(file);
            }).forEach(function(file) {
              compilation.assets[file] = new ConcatSource(banner, compilation.assets[file]);
            });
          });
          callback();
        });
      });
    }
  }

  compiler.plugin('done', function(stats) {
    // clean out stale prod assets if running in dev mode and vice versa
    if (fs.existsSync(assetsFile)) {
      var assets = JSON.parse(fs.readFileSync(assetsFile));
      assets.forEach(function(asset) {
        if (fs.existsSync(asset)) {
          rm('-r', asset);
        }
      });
    }

    var jsonStats = stats.toJson({
      source: false,
      modules: false,
    });
    // console.log(JSON.stringify(jsonStats, null, "  "));

    var curOutputDir = outputDir;
    var match = new RegExp('^(http://[^/]+)?(/.*)$').exec(jsonStats.publicPath);
    if (match) {
      curOutputDir += match[2];
    }

    var assets = [];

    if (!fs.existsSync(curOutputDir)) {
      assets.push(curOutputDir);
      shell.mkdir('-p', curOutputDir);
    }
    jsonStats.assets.forEach(function(asset) {
      var assetPath = path.join(compiler.options.output.path, asset.name);

      function justCopy(target) {
        target = target || path.join(curOutputDir, asset.name);
        assets.push(target);
        cp('-f', assetPath, target);
      }

      function writeFile(targetFile, code) {
        assets.push(targetFile);
        fs.writeFileSync(targetFile, code);
      }

      if (!/\.js$/.test(asset.name) && compiler.options.devServer) {
        return;
      }

      if (!/\.(js|map)$/.test(asset.name)) {
        return justCopy();
      }

      switch (target) {
        case 'client':
          switch(mode) {
            case 'development':
              var loadClientBundleHtml = createLoadClientBundleHtml(jsonStats.publicPath + asset.name);
              var targetFile = path.join(curOutputDir, 'load.' + asset.name + '.html');
              writeFile(targetFile, loadClientBundleHtml);
              break;
            case 'production':
              if (/\.js$/.test(asset.name)) {
                return justCopy(path.join(curOutputDir, renameToMinJs(asset.name)));
              }
              justCopy();
              break;
          }
          break;
        case 'server':
          switch(mode) {
            case 'development':
              if (/\.map$/.test(asset.name)) {
                return;
              } 
              var requireBundleCode = '//' + jsonStats.hash + '\n' + // hash helps Meteor detect changes
                // stuff these variables in a hacky location so that we can Npm.require
                // the bundle and then put these back on local scope where they're expected
                // it's okay, it's just dev mode, and this makes individual files show up
                // (maybe I should find a better global var though)
                // in node-inspector (and I think it's the only way one can use source-map-support)
                'Meteor.__mwrContext__ = {Npm: Npm, Assets: Assets};\n' +
                'Npm.require("' + assetPath.replace(/\\/g, '\\\\') + '");';
              var targetFile = path.join(curOutputDir, 'require.' + asset.name);
              writeFile(targetFile, requireBundleCode);
              break;
            case 'production':
              if (/\.js$/.test(asset.name)) {
                return justCopy(path.join(curOutputDir, renameToMinJs(asset.name)));
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
    fs.writeFileSync(assetsFile, JSON.stringify(assets, null, "  "));
  });
};

module.exports = RunInMeteorPlugin;

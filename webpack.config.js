const path = require("path");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const WextManifestWebpackPlugin = require("wext-manifest-webpack-plugin");

const staticPath = path.join(__dirname, "static");
const destPath = path.join(__dirname, "dist");
const targetBrowser = process.env.TARGET_BROWSER;

module.exports = {
  mode: "production",
  entry: {
    manifest: "./src/manifest.json",
    background: "./src/background.ts",
    content: "./src/content.ts",
    popup: "./src/popup.tsx",
  },
  output: {
    path: path.join(destPath, targetBrowser),
    filename: "js/[name].bundle.js",
    clean: true,
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js"],
    fallback: {
        "stream": false,
    }
  },
  module: {
    rules: [
      {
        type: "javascript/auto",
        test: /manifest\.json$/,
        use: {
          loader: "wext-manifest-loader",
          options: {
            usePackageJSONVersion: true,
          },
        },
        exclude: /node_modules/,
      },
      {
        test: /\.(js|ts)x?$/,
        exclude: /node_modules/,
        use: {
          loader: "swc-loader",
        },
      },
    ],
  },
  plugins: [
    new WextManifestWebpackPlugin(),
    new HtmlWebpackPlugin({
      template: path.join(staticPath, "popup.html"),
      inject: "body",
      chunks: ["popup"],
      filename: "popup.html",
    }),
    new CopyWebpackPlugin({
      patterns: [
        { from: "static/icon01.png", to: "icon01.png" },
        { from: "static/popup.css", to: "popup.css" },
      ],
    }),
  ],
};
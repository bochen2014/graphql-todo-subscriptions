import path from 'path';

import express from 'express';
import http from 'http';
import IO from 'socket.io';
import {graphql} from 'graphql';
import webpack from 'webpack';
import webpackMiddleware from 'webpack-dev-middleware';

import {connect} from './server/socket';
import {startWorkers} from './server/workers';

const APP_PORT = 3000;

const compiler = webpack({
  entry: path.resolve(__dirname, 'js', 'app.js'),
  module: {
    loaders: [{
      test: /\.js$/,
      exclude: /node_modules/,
      loader: 'babel-loader'
    }]
  },
  output: {filename: 'app.js', path: '/'}
});

const app = express();
const server = http.Server(app);
const io = IO(server);

// start back-end workers which will listen for subscription events
// and execute graphql queries
startWorkers();

// start a new client for this socket-io connection
io.on('connection', socket => {
  connect(socket);
});

app.use('/', express.static('public'));

// USING IN PROD, RUNNING WITH SCISSORS
app.use(webpackMiddleware(compiler, {
  contentBase: '/public/',
  publicPath: '/js',
  stats: {colors: true}
}));

server.listen(APP_PORT, () => {
  console.log(`App is now running on http://localhost:${APP_PORT}`);
});

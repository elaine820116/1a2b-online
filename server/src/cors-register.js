import express from 'express';

const originalInit = express.application.init;

express.application.init = function initWithCors() {
  originalInit.call(this);
  this.use((request, response, next) => {
    const allowedOrigins = new Set([
      'https://onea2b-online.onrender.com',
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ]);
    const origin = request.headers.origin;
    if (allowedOrigins.has(origin)) response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (request.method === 'OPTIONS') return response.sendStatus(204);
    return next();
  });
};

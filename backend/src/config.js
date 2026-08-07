'use strict';

const path = require('path');

module.exports = {
  port: parseInt(process.env.PORT || '4000', 10),
  dataDir: process.env.ACIAS_DATA_DIR || path.join(__dirname, '..', 'data'),
  jwtSecret: process.env.JWT_SECRET || 'acias-dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  storageDir: path.join(__dirname, '..', 'storage'),
  uploadDir: path.join(__dirname, '..', 'storage', 'uploads'),
  aiProvider: process.env.ACIAS_AI_PROVIDER || 'mock'
};

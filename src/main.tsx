import React from 'react';
import ReactDOM from 'react-dom/client';
import 'pixel-retroui/dist/index.css';
import './styles/app.css';
import { App } from './app/App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
);

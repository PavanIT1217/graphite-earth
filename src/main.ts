import './style.css';
import { App } from './app';
import { registerServiceWorker } from './pwa/register';

function webgl2Supported(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

if (webgl2Supported()) {
  new App().start();
} else {
  document.body.innerHTML =
    '<div class="noscript"><h1>Graphite Earth</h1><p>Sorry — this device or browser does not support WebGL 2, which is needed to draw the 3D sketch.</p></div>';
}
registerServiceWorker();

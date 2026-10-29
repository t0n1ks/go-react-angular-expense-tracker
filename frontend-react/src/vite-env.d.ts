/// <reference types="vite/client" />

// lottie-web ships typings for its UMD builds only; the ES-module light build
// (used by CompanionUfo) has the same API.
declare module 'lottie-web/build/player/esm/lottie_light.min.js' {
  import lottie from 'lottie-web';
  export default lottie;
}

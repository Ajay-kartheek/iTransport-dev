/// <reference types="vite/client" />

interface Window {
  __itMapsReady?: () => void;
  gm_authFailure?: () => void;
}

interface Navigator {
  standalone?: boolean;
}

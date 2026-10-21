import App from "./App";
import { ThemeProvider } from "./contexts/ThemeContext";
import { ToastProvider } from "./contexts/ToastContext";
import { ConfirmProvider } from "./contexts/ConfirmContext";

/**
 * App-wide providers, shared by the admin app and the doctor share surface.
 * Only add providers here that make no backend calls: admin providers
 * (auth, patient, pipeline status) belong in AdminProviders in App.tsx,
 * otherwise every share page fires admin requests that 404 on the share
 * container and get the doctor banned by the public proxy's fail2ban.
 */
export default function Root() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <ConfirmProvider>
          <App />
        </ConfirmProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

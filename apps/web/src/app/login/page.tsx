import { LoginPanel } from "./LoginPanel";

// Server Component: legge le env var (server-side, NON esposte al client) per
// decidere quali metodi di login mostrare. `GOOGLE_CLIENT_ID` /
// `AUTH_IBMSSO_ID` non hanno prefisso NEXT_PUBLIC_, quindi sono leggibili solo
// qui (lato server) e passati come booleani al client `LoginPanel`.
export default function LoginPage() {
  const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID);
  const ibmssoEnabled = Boolean(process.env.AUTH_IBMSSO_ID);
  return <LoginPanel googleEnabled={googleEnabled} ibmssoEnabled={ibmssoEnabled} />;
}

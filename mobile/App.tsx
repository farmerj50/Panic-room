import AppNavigator from "./src/navigation/AppNavigator";
import { configurePurchases } from "./src/services/purchasesService";
import { configureAnalytics } from "./src/services/analyticsService";

// SDK init only — no user identity is attached yet (that happens in
// AuthContext once a session is known), so this is safe to run unconditionally.
configurePurchases();
configureAnalytics();

export default function App() {
  return <AppNavigator />;
}
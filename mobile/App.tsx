import AppNavigator from "./src/navigation/AppNavigator";
import { configurePurchases } from "./src/services/purchasesService";

// SDK init only — no user identity is attached yet (that happens in
// AuthContext once a session is known), so this is safe to run unconditionally.
configurePurchases();

export default function App() {
  return <AppNavigator />;
}
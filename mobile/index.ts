// Background task definitions must be registered before registerRootComponent.
// expo-task-manager defineTask calls are top-level in these files.
import './src/tasks/backgroundLocation';

import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);

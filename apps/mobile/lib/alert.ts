import { Alert, Platform } from "react-native";

/**
 * Cross-platform alert. react-native-web's Alert.alert is a no-op, which
 * silently swallows the message AND any navigation in its button callback —
 * the screen just freezes. On web, window.alert blocks until dismissed and
 * then the callback runs, matching the native flow closely enough.
 */
export function showAlert(title: string, message?: string, onDismiss?: () => void) {
  if (Platform.OS === "web") {
    window.alert(message ? `${title}\n\n${message}` : title);
    onDismiss?.();
    return;
  }
  Alert.alert(title, message, [{ text: "OK", onPress: onDismiss }]);
}

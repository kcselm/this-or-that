import { Stack } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-reanimated";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: "#6C47FF" },
          headerTintColor: "#fff",
          headerTitleStyle: { fontWeight: "bold" },
        }}
      >
        <Stack.Screen name="index" options={{ title: "This or That" }} />
        <Stack.Screen name="create/index" options={{ title: "Create Room" }} />
        <Stack.Screen name="create/items" options={{ title: "Add Items" }} />
        <Stack.Screen name="create/share" options={{ title: "Share Room" }} />
        <Stack.Screen name="join/index" options={{ title: "Join Room" }} />
        <Stack.Screen name="join/name" options={{ title: "Your Name" }} />
        <Stack.Screen name="room/[code]/lobby" options={{ title: "Waiting", headerBackVisible: false }} />
        <Stack.Screen name="room/[code]/swipe" options={{ title: "Swipe", headerBackVisible: false }} />
        <Stack.Screen name="room/[code]/waiting" options={{ title: "Waiting", headerBackVisible: false }} />
        <Stack.Screen name="room/[code]/results" options={{ title: "Results", headerBackVisible: false }} />
      </Stack>
    </GestureHandlerRootView>
  );
}

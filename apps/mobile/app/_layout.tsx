import { Stack } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-reanimated";
import { colors } from "../lib/theme";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.cream },
          headerTintColor: colors.coral,
          headerTitleStyle: {
            fontWeight: "700",
            fontSize: 17,
            color: colors.charcoal,
          },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.cream },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="create/index" options={{ title: "Create Room" }} />
        <Stack.Screen name="create/mode" options={{ title: "New Room" }} />
        <Stack.Screen name="create/share" options={{ title: "Build & Share", headerBackVisible: false }} />
        <Stack.Screen name="create/mlt-prompts" options={{ title: "Pick prompts", headerShown: false }} />
        <Stack.Screen name="lists/index" options={{ title: "My Lists" }} />
        <Stack.Screen name="lists/[id]" options={{ title: "List" }} />
        <Stack.Screen name="history" options={{ title: "Past Results" }} />
        <Stack.Screen name="join/index" options={{ title: "Join Room" }} />
        <Stack.Screen name="join/name" options={{ title: "Your Name" }} />
        <Stack.Screen name="room/[code]/lobby" options={{ title: "Waiting", headerBackVisible: false }} />
        <Stack.Screen name="room/[code]/swipe" options={{ headerShown: false }} />
        <Stack.Screen name="room/[code]/rank" options={{ headerShown: false }} />
        <Stack.Screen name="room/[code]/bracket" options={{ headerShown: false }} />
        <Stack.Screen name="room/[code]/mlt" options={{ title: "Most Likely To", headerShown: false }} />
        <Stack.Screen name="room/[code]/tier" options={{ headerShown: false }} />
        <Stack.Screen name="room/[code]/round-reveal" options={{ headerShown: false }} />
        <Stack.Screen name="room/[code]/waiting" options={{ title: "Waiting", headerBackVisible: false }} />
        <Stack.Screen name="room/[code]/results" options={{ headerShown: false }} />
      </Stack>
    </GestureHandlerRootView>
  );
}

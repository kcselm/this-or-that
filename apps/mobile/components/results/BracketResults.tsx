import { View, Text, ScrollView, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import type { BracketResults as BracketResultsData } from "../../lib/api";
import { spacing } from "../../lib/theme";
import BracketView from "../BracketView";
import { resultStyles, type ResultsViewProps } from "./styles";

export default function BracketResults({ data, homeLabel, onHome }: ResultsViewProps<BracketResultsData>) {
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={resultStyles.container}
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: spacing.xxl }}
    >
      <Animated.View entering={FadeInUp.duration(500).springify()} style={resultStyles.winnerCard}>
        <Text style={resultStyles.winnerLabel}>WINNER</Text>
        <Text style={resultStyles.winnerTitle}>{data.winner?.title ?? "—"}</Text>
      </Animated.View>

      <Animated.Text entering={FadeInDown.duration(400).delay(150)} style={resultStyles.topic}>
        {data.topic}
      </Animated.Text>
      <Animated.Text entering={FadeInDown.duration(400).delay(200)} style={resultStyles.meta}>
        {data.totalRounds} rounds · tap a matchup to see who voted
      </Animated.Text>

      <View style={{ marginTop: spacing.lg }}>
        <BracketView rounds={data.rounds} expandableBreakdowns />
      </View>

      <Pressable
        style={({ pressed }) => [resultStyles.homeLink, pressed && { opacity: 0.6 }]}
        onPress={onHome}
      >
        <Text style={resultStyles.homeLinkText}>{homeLabel}</Text>
      </Pressable>
    </ScrollView>
  );
}

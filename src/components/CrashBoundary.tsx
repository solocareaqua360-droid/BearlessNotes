import { Component, ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { FONT_BOLD, FONT_REGULAR } from '../utils/fonts';

// A crash, said out loud.
//
// On a phone a render that throws leaves a red screen with the error on
// it. In a browser it leaves NOTHING - React unmounts the tree and the
// page goes white, with the reason only in a console nobody has open.
// "Білий екран" is all anyone can report, and it is the same report for
// every possible cause.
//
// So the error is put on the page. Not for the person using the app -
// for whoever is trying to fix it, which for a while is the same person.
type Props = { children: ReactNode };
type State = { error: Error | null };

export default class CrashBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>Щось зламалося</Text>
        <Text style={styles.body}>{error.message || String(error)}</Text>
        <ScrollView style={styles.stackBox}>
          <Text style={styles.stack}>{error.stack ?? ''}</Text>
        </ScrollView>
        <Pressable style={styles.button} onPress={() => this.setState({ error: null })}>
          <Text style={styles.buttonLabel}>Спробувати ще раз</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    gap: 12,
    padding: 28,
    backgroundColor: '#171310',
  },
  title: {
    fontSize: 20,
    fontFamily: FONT_BOLD,
    color: '#fff',
  },
  body: {
    fontSize: 15,
    lineHeight: 21,
    fontFamily: FONT_REGULAR,
    color: '#FB7185',
  },
  stackBox: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    padding: 12,
  },
  stack: {
    fontSize: 11,
    lineHeight: 16,
    fontFamily: FONT_REGULAR,
    color: 'rgba(255,255,255,0.62)',
  },
  button: {
    alignSelf: 'flex-start',
    borderRadius: 16,
    backgroundColor: '#F5C77E',
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  buttonLabel: {
    fontSize: 15,
    fontFamily: FONT_BOLD,
    color: '#171310',
  },
});

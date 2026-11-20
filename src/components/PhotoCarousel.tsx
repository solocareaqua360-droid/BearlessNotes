import { useState } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { RelationThumb } from './CustomRowCard';

type Item = { uri: string; driveFileId?: string };

// The photos of one record, swiped through one at a time - a car's side,
// rear, engine and tyres, where a single cover can only ever show one of
// them. Pages are sized from the live window width rather than a captured
// constant, for the reason CalendarScreen's PLATE_MARGIN comment spells
// out at length.
export default function PhotoCarousel({ items, horizontalMargin = 16 }: { items: Item[]; horizontalMargin?: number }) {
  const { width: windowWidth } = useWindowDimensions();
  const pageWidth = windowWidth - horizontalMargin * 2;
  const [page, setPage] = useState(0);

  if (items.length === 0) return null;

  function handleScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    setPage(Math.round(e.nativeEvent.contentOffset.x / pageWidth));
  }

  return (
    <View style={styles.wrap}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScrollEnd}
      >
        {items.map((item, index) => (
          <View key={`${item.uri}-${index}`} style={[styles.page, { width: pageWidth }]}>
            <RelationThumb uri={item.uri} driveFileId={item.driveFileId} fill />
          </View>
        ))}
      </ScrollView>

      {/* Dots only once there's more than one - a single photo with a lone
          dot under it reads as a broken control. */}
      {items.length > 1 && (
        <View style={styles.dots}>
          {items.map((item, index) => (
            <View key={`${item.uri}-dot-${index}`} style={[styles.dot, index === page && styles.dotActive]} />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 8,
  },
  page: {
    aspectRatio: 1.5,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#F3F4F6',
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#D1D5DB',
  },
  dotActive: {
    backgroundColor: '#6B7280',
  },
});

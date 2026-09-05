import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import './src/firebase';
import DocumentsScreen from './src/screens/DocumentsScreen';
import PlaceholderScreen from './src/screens/PlaceholderScreen';
import DatabasesScreen from './src/screens/DatabasesScreen';
import TasksScreen from './src/screens/TasksScreen';
import LinksScreen from './src/screens/LinksScreen';
import PhotosScreen from './src/screens/PhotosScreen';
import FilesScreen from './src/screens/FilesScreen';
import DocumentEditorScreen from './src/screens/DocumentEditorScreen';
import { RootStackParamList } from './src/navigation';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator<RootStackParamList>();

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: '#3B82F6',
        tabBarInactiveTintColor: '#9CA3AF',
      }}
    >
      <Tab.Screen
        name="Документи"
        component={DocumentsScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="document-text-outline" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Пошук"
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="search-outline" size={size} color={color} />
          ),
        }}
      >
        {() => <PlaceholderScreen icon="search-outline" label="Скоро" />}
      </Tab.Screen>
      <Tab.Screen
        name="Календар"
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="calendar-outline" size={size} color={color} />
          ),
        }}
      >
        {() => <PlaceholderScreen icon="calendar-outline" label="Скоро" />}
      </Tab.Screen>
      <Tab.Screen
        name="Більше"
        component={DatabasesScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="ellipsis-horizontal-outline" size={size} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <NavigationContainer>
        <StatusBar style="auto" />
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Tabs" component={Tabs} />
          <Stack.Screen name="Editor" component={DocumentEditorScreen} />
          <Stack.Screen name="Tasks" component={TasksScreen} />
          <Stack.Screen name="Links" component={LinksScreen} />
          <Stack.Screen name="Photos" component={PhotosScreen} />
          <Stack.Screen name="Files" component={FilesScreen} />
          <Stack.Screen name="Placeholder">
            {({ route }) => <PlaceholderScreen icon={route.params.icon} label={route.params.label} />}
          </Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
    </GestureHandlerRootView>
  );
}

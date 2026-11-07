import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '../icons/Ionicons';
import RenamePrompt from '../RenamePrompt';
import { ask, confirm } from '../surfaces/Ask';
import { go, placeNow } from '../DesktopTabs';
import { tabKey } from '../../navigation/desktopTabs';
import { useWorkspace } from '../../navigation/workspace';
import {
  applyTemplate,
  deleteTemplate,
  renameTemplate,
  saveAsTemplate,
  updateTemplate,
  useActiveTemplateId,
  useTemplateDirty,
  useWorkspaceTemplates,
  type WorkspaceTemplate,
} from '../../navigation/workspaceTemplates';
import { rightClick } from '../../utils/rightClick';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../../utils/fonts';
import { useStyles, useTheme } from '../../theme/ThemeProvider';
import type { Theme } from '../../theme/tokens';

// «Шаблони» in the rail - see navigation/workspaceTemplates. A row per saved
// window; the one the window stands in is lit, and carries a dot and a
// «save» button while the window differs from what was saved.

function activeKeyNow(): string | null {
  const place = placeNow();
  if (!place) return null;
  return place.kind === 'home' ? 'home' : tabKey(place.kind, place.ref);
}

function TemplateRow({ template, active }: { template: WorkspaceTemplate; active: boolean }) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const workspace = useWorkspace();
  const dirty = useTemplateDirty(active ? template : undefined, workspace);
  const [renaming, setRenaming] = useState(false);

  function open() {
    if (!workspace) return;
    applyTemplate(template, workspace);
    const front = template.activeKey;
    const tab = front && front !== 'home' ? (template.tabs ?? []).find((t) => t.key === front) ?? null : null;
    // A beat for the row to take the new tabs before one of them is gone to.
    setTimeout(() => go(tab), 0);
  }

  async function menu() {
    if (!workspace) return;
    const choice = await ask({
      title: template.name,
      actions: [
        { id: 'update', label: 'Зберегти поточний вигляд', icon: 'save-outline' },
        { id: 'rename', label: 'Перейменувати', icon: 'pencil-outline' },
        { id: 'delete', label: 'Видалити', icon: 'trash-outline', tone: 'danger' },
      ],
    });
    if (choice === 'update') await updateTemplate(template.id, workspace, activeKeyNow());
    else if (choice === 'rename') setRenaming(true);
    else if (choice === 'delete') {
      const yes = await confirm({ title: `Видалити шаблон «${template.name}»?`, confirmLabel: 'Видалити' });
      if (yes) await deleteTemplate(template.id);
    }
  }
  return (
    <>
      <Pressable
        style={(state) => [
          styles.row,
          active && styles.rowActive,
          !active && (state as { hovered?: boolean }).hovered && styles.rowHover,
        ]}
        onPress={open}
        {...rightClick(menu)}
      >
        <Ionicons name="browsers-outline" size={16} color={active ? theme.accent : theme.ink.muted} />
        <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
          {template.name}
        </Text>
        {dirty && (
          <>
            <View style={[styles.dot, { backgroundColor: theme.accent }]} />
            <Pressable
              hitSlop={6}
              style={styles.save}
              accessibilityLabel="Зберегти зміни"
              {...({ title: 'Зберегти зміни' } as object)}
              onPress={() => workspace && updateTemplate(template.id, workspace, activeKeyNow())}
            >
              <Ionicons name="checkmark" size={15} color={theme.accent} />
            </Pressable>
          </>
        )}
      </Pressable>
      <RenamePrompt
        visible={renaming}
        title="Назва шаблону"
        initialValue={template.name}
        onCancel={() => setRenaming(false)}
        onSave={(name) => {
          setRenaming(false);
          renameTemplate(template.id, name.trim() || template.name);
        }}
      />
    </>
  );
}

export default function TemplatesGroup() {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const workspace = useWorkspace();
  const templates = useWorkspaceTemplates();
  const activeId = useActiveTemplateId();
  const [naming, setNaming] = useState(false);
  if (!workspace) return null;
  return (
    <View style={styles.group}>
      <Text style={styles.heading}>Шаблони</Text>
      {templates.map((template) => (
        <TemplateRow key={template.id} template={template} active={template.id === activeId} />
      ))}
      <Pressable
        style={(state) => [styles.row, (state as { hovered?: boolean }).hovered && styles.rowHover]}
        onPress={() => setNaming(true)}
      >
        <Ionicons name="add" size={16} color={theme.ink.faint} />
        <Text style={[styles.label, { color: theme.ink.faint }]}>Зберегти як шаблон</Text>
      </Pressable>
      <RenamePrompt
        visible={naming}
        title="Новий шаблон"
        initialValue=""
        placeholder="Наприклад, «Планування авто»"
        onCancel={() => setNaming(false)}
        onSave={(name) => {
          setNaming(false);
          if (name.trim()) saveAsTemplate(name.trim(), workspace, activeKeyNow());
        }}
      />
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    group: { paddingHorizontal: 8, gap: 2, marginTop: 10 },
    heading: { fontSize: 13, fontFamily: FONT_SEMIBOLD, color: t.ink.faint, paddingHorizontal: 10, paddingBottom: 2 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 32, paddingHorizontal: 10, borderRadius: 8 },
    rowActive: { backgroundColor: t.selected },
    rowHover: { backgroundColor: t.selected },
    label: { flex: 1, fontSize: 14, fontFamily: FONT_REGULAR, color: t.ink.muted },
    labelActive: { fontFamily: FONT_SEMIBOLD, color: t.ink.primary },
    dot: { width: 7, height: 7, borderRadius: 4 },
    save: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  });

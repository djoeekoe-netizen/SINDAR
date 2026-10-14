import { useEffect, useState } from 'preact/hooks';
import type { ScanWarningDTO, SkillDTO } from '../../../gateway/src/protocol.ts';
import { getApi, lang, showToast, skillsOpen } from '../lib/store.ts';
import { t } from '../lib/i18n.ts';
import { renderMarkdown } from '../lib/markdown.ts';

type View = { kind: 'list' } | { kind: 'detail'; name: string } | { kind: 'new' };

export function SkillsPanel() {
  const l = lang.value;
  const open = skillsOpen.value;
  const [skills, setSkills] = useState<SkillDTO[]>([]);
  const [view, setView] = useState<View>({ kind: 'list' });
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const api = getApi();
    if (!api) return;
    setBusy(true);
    setError(undefined);
    try {
      setSkills((await api.skills()).skills);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (open) {
      setView({ kind: 'list' });
      void load();
    }
  }, [open]);
  if (!open) return null;
  const close = () => (skillsOpen.value = false);

  return (
    <div class="modal-scrim" onClick={close}>
      <div class="modal tall" onClick={(e) => e.stopPropagation()}>
        <div class="modal-head">
          <strong>
            {view.kind !== 'list' && (
              <button
                class="icon-btn"
                onClick={() => setView({ kind: 'list' })}
                aria-label={t(l, 'skills.back')}
              >
                ‹
              </button>
            )}
            📘 {view.kind === 'detail' ? view.name : t(l, 'skills.title')}
          </strong>
          <button class="icon-btn" onClick={close} aria-label={t(l, 'common.close')}>
            ✕
          </button>
        </div>
        <div class="modal-body skills">
          {error && <div class="notice error">{error}</div>}
          {view.kind === 'list' && (
            <SkillList
              skills={skills}
              busy={busy}
              onOpen={(name) => setView({ kind: 'detail', name })}
              onNew={() => setView({ kind: 'new' })}
              onChanged={() => void load()}
            />
          )}
          {view.kind === 'detail' && (
            <SkillDetail
              name={view.name}
              onDeleted={() => {
                setView({ kind: 'list' });
                void load();
              }}
            />
          )}
          {view.kind === 'new' && (
            <NewSkill
              onCreated={(name) => {
                void load();
                setView({ kind: 'detail', name });
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function SkillList(props: {
  skills: SkillDTO[];
  busy: boolean;
  onOpen: (name: string) => void;
  onNew: () => void;
  onChanged: () => void;
}) {
  const l = lang.value;
  const [source, setSource] = useState('');
  const [installing, setInstalling] = useState(false);
  const [preview, setPreview] = useState<
    { names: string[]; warnings: ScanWarningDTO[]; danger: boolean } | undefined
  >();
  const [installError, setInstallError] = useState<string | undefined>();

  const install = async (force = false) => {
    const api = getApi();
    if (!api || !source.trim()) return;
    setInstalling(true);
    setInstallError(undefined);
    try {
      if (!force) {
        const p = await api.installSkill({ source: source.trim(), dryRun: true });
        const warnings = (p.preview ?? []).flatMap((x) => x.warnings);
        const danger = warnings.some((w) => w.level === 'danger');
        setPreview({ names: (p.preview ?? []).map((x) => x.name), warnings, danger });
        if (danger) return; // wait for the explicit confirmation button
      }
      const r = await api.installSkill({ source: source.trim(), force, overwrite: true });
      const names = (r.installed ?? []).map((x) => x.skill.name);
      showToast(t(l, 'skills.install.done', { names: names.join(', ') }));
      setSource('');
      setPreview(undefined);
      props.onChanged();
    } catch (err) {
      setInstallError((err as Error).message);
    } finally {
      setInstalling(false);
    }
  };

  return (
    <>
      <p class="muted small">{t(l, 'skills.intro')}</p>
      <button class="btn primary wide" onClick={props.onNew}>
        ＋ {t(l, 'skills.new')}
      </button>
      <div class="skill-list">
        {props.skills.length === 0 && !props.busy && (
          <div class="muted small pad">{t(l, 'skills.empty')}</div>
        )}
        {props.skills.map((s) => (
          <button key={s.name} class="skill" onClick={() => props.onOpen(s.name)}>
            <div class="skill-head">
              <span class="skill-name" dir="ltr">
                {s.name}
              </span>
              <span class={`badge ${s.source}`}>{t(l, `skills.source.${s.source}` as const)}</span>
            </div>
            <div class="skill-desc muted small" dir="auto">
              {s.description}
            </div>
          </button>
        ))}
      </div>
      <section class="install">
        <h3>{t(l, 'skills.install.title')}</h3>
        <div class="actions">
          <input
            dir="ltr"
            value={source}
            placeholder={t(l, 'skills.install.placeholder')}
            onInput={(e) => {
              setSource((e.target as HTMLInputElement).value);
              setPreview(undefined);
            }}
          />
          <button
            class="btn primary"
            disabled={installing || !source.trim()}
            onClick={() => void install(false)}
          >
            {installing ? t(l, 'skills.install.checking') : t(l, 'skills.install.button')}
          </button>
        </div>
        {installError && <div class="notice error">{installError}</div>}
        {preview && preview.warnings.length > 0 && (
          <div class={`notice ${preview.danger ? 'error' : 'warn'}`}>
            <strong>{t(l, 'skills.install.warnings', { n: preview.warnings.length })}</strong>
            <ul dir="ltr">
              {preview.warnings.slice(0, 12).map((w, i) => (
                <li key={i}>
                  <code>
                    {w.file}:{w.line}
                  </code>{' '}
                  — {w.pattern}
                  <div class="muted small">{w.text}</div>
                </li>
              ))}
            </ul>
            {preview.danger && (
              <>
                <p>{t(l, 'skills.install.danger', { n: preview.names.join(', ') })}</p>
                <button class="btn danger" disabled={installing} onClick={() => void install(true)}>
                  {t(l, 'skills.install.force')}
                </button>
              </>
            )}
          </div>
        )}
        <p class="muted small">{t(l, 'skills.install.note')}</p>
      </section>
    </>
  );
}

function SkillDetail(props: { name: string; onDeleted: () => void }) {
  const l = lang.value;
  const [skill, setSkill] = useState<SkillDTO | undefined>();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const load = async () => {
    const api = getApi();
    if (!api) return;
    try {
      const r = await api.skill(props.name);
      setSkill(r.skill);
      setBody(r.skill.body ?? '');
      setDescription(r.skill.description);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  useEffect(() => {
    void load();
  }, [props.name]);

  const save = async () => {
    const api = getApi();
    if (!api) return;
    setBusy(true);
    setError(undefined);
    try {
      const r = await api.updateSkill(props.name, { body, description });
      setSkill(r.skill);
      setEditing(false);
      showToast(t(l, 'skills.updated', { name: props.name }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    const api = getApi();
    if (!api || !confirm(t(l, 'skills.delete.confirm', { name: props.name }))) return;
    setBusy(true);
    try {
      await api.deleteSkill(props.name);
      showToast(t(l, 'skills.deleted', { name: props.name }));
      props.onDeleted();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  if (!skill)
    return error ? <div class="notice error">{error}</div> : <div class="muted small pad">…</div>;
  return (
    <>
      <div class="skill-meta muted small">
        <span class={`badge ${skill.source}`}>
          {t(l, `skills.source.${skill.source}` as const)}
        </span>{' '}
        {t(l, 'skills.version', { v: skill.version })}
        {skill.origin ? (
          <>
            {' · '}
            <code dir="ltr">{skill.origin}</code>
          </>
        ) : null}
        {skill.path ? (
          <>
            <br />
            <code dir="ltr">{skill.path}</code>
          </>
        ) : null}
      </div>
      {error && <div class="notice error">{error}</div>}
      {editing ? (
        <>
          <input
            dir="auto"
            value={description}
            onInput={(e) => setDescription((e.target as HTMLInputElement).value)}
          />
          <textarea
            class="memory-editor"
            dir="auto"
            value={body}
            onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)}
          />
          <div class="actions">
            <button class="btn primary" disabled={busy} onClick={() => void save()}>
              {t(l, 'memory.save')}
            </button>
            <button class="btn" disabled={busy} onClick={() => setEditing(false)}>
              {t(l, 'common.cancel')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p dir="auto">{skill.description}</p>
          <div
            class="md skill-body"
            dir="auto"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }}
          />
          {skill.files && skill.files.length > 0 && (
            <div class="muted small">
              <strong>{t(l, 'skills.files')}:</strong>{' '}
              <code dir="ltr">{skill.files.join(', ')}</code>
            </div>
          )}
          <div class="actions">
            {skill.source !== 'extra' && (
              <button class="btn" onClick={() => setEditing(true)}>
                ✎ {t(l, 'skills.edit')}
              </button>
            )}
            {skill.source !== 'extra' && (
              <button class="btn danger" disabled={busy} onClick={() => void remove()}>
                🗑 {t(l, 'skills.delete')}
              </button>
            )}
          </div>
        </>
      )}
    </>
  );
}

function NewSkill(props: { onCreated: (name: string) => void }) {
  const l = lang.value;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [body, setBody] = useState('## Steps\n1. \n\n## Pitfalls\n- ');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const create = async () => {
    const api = getApi();
    if (!api) return;
    setBusy(true);
    setError(undefined);
    try {
      const r = await api.createSkill({ name: name.trim(), description: description.trim(), body });
      showToast(t(l, 'skills.created', { name: r.skill.name }));
      props.onCreated(r.skill.name);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <label class="field">
        <span class="muted small">{t(l, 'skills.new.name')}</span>
        <input
          dir="ltr"
          value={name}
          placeholder="weekly-report"
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
        />
      </label>
      <label class="field">
        <span class="muted small">{t(l, 'skills.new.description')}</span>
        <input
          dir="auto"
          value={description}
          onInput={(e) => setDescription((e.target as HTMLInputElement).value)}
        />
      </label>
      <label class="field">
        <span class="muted small">{t(l, 'skills.new.body')}</span>
        <textarea
          class="memory-editor"
          dir="auto"
          value={body}
          onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)}
        />
      </label>
      {error && <div class="notice error">{error}</div>}
      <button
        class="btn primary"
        disabled={busy || !name.trim() || !description.trim() || !body.trim()}
        onClick={() => void create()}
      >
        {t(l, 'skills.new.create')}
      </button>
    </>
  );
}

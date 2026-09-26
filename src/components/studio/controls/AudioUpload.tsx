import { useRef } from 'react'
import { useT } from '../../../i18n'
import { formatBytes } from '../../../lib/format'
import { useSetupStore } from '../../../store/useSetupStore'
import { InfoNote, Labeled } from '../../ui/controls'
import { IconMusic, IconUpload } from '../../ui/icons'
import { Chip } from '../../ui/Glass'

/** رفع ملف صوتي (MP3/M4A/AAC) أو فيديو يُستخرج صوته تلقائياً */
export function AudioUpload() {
  const t = useT()
  const file = useSetupStore((s) => s.uploadedFile)
  const setFile = useSetupStore((s) => s.setUploadedFile)
  const inputRef = useRef<HTMLInputElement>(null)

  const isVideo = !!file && file.type.startsWith('video/')

  return (
    <Labeled label={t('setup.uploadAudio')}>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,video/*"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f && (f.type.startsWith('audio/') || f.type.startsWith('video/'))) setFile(f)
          e.target.value = ''
        }}
      />

      {file ? (
        <div className="file-pill">
          <span className="file-pill__icon">
            <IconMusic size={18} />
          </span>
          <span className="file-pill__name" dir="ltr">
            {file.name}
          </span>
          <span className="file-pill__size">{formatBytes(file.size)}</span>
          {isVideo && <Chip tone="emerald">video → audio</Chip>}
          <button type="button" className="file-pill__clear" onClick={() => setFile(null)}>
            ×
          </button>
        </div>
      ) : (
        <button type="button" className="dropzone" onClick={() => inputRef.current?.click()}>
          <span className="dropzone__icon">
            <IconUpload size={22} />
          </span>
          <span className="dropzone__label">{t('setup.uploadAudio')}</span>
          <span className="dropzone__hint">{t('setup.uploadAudioHint')}</span>
        </button>
      )}

      <InfoNote>{t('setup.uploadNote')}</InfoNote>
    </Labeled>
  )
}

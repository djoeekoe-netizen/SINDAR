import { createFileRoute } from '@tanstack/react-router'
import { StudioShell } from '../components/studio/StudioShell'
import { StepperBar } from '../components/studio/StepperBar'
import { PreviewCard } from '../components/studio/PreviewCard'
import { SetupStep } from '../components/studio/steps/SetupStep'
import { DesignStep } from '../components/studio/steps/DesignStep'
import { ExportStep } from '../components/studio/steps/ExportStep'
import { useUIStore } from '../store/useUIStore'

export const Route = createFileRoute('/')({ component: StudioPage })

/**
 * صفحة الاستوديو الواحدة — الخطوات الثلاث داخل نفس الصفحة،
 * والكانفس/الوسائط تعيش في StudioShell فلا يُعاد تصييرها أبداً عند التنقل.
 */
function StudioPage() {
  const step = useUIStore((s) => s.step)

  return (
    <StudioShell>
      <div className="studio">
        <StepperBar />
        <main className="studio__main">
          <PreviewCard />
          <div className="studio__panel" key={step}>
            {step === 'setup' && <SetupStep />}
            {step === 'design' && <DesignStep />}
            {step === 'export' && <ExportStep />}
          </div>
        </main>
        <footer className="studio__footer">SINDAR · صنع بعناية لخدمة المحتوى القرآني 🤍</footer>
      </div>
    </StudioShell>
  )
}

import AppLayout from '@/components/AppLayout';
import { Sk } from '@/components/Skeleton';

export default function DashboardLoading() {
  return (
    <AppLayout>
      <div>
        {/* Header */}
        <div className="mb-8">
          <Sk className="h-3 w-24 mb-2" />
          <Sk className="h-9 w-44" />
        </div>

        {/* KPI cards — financeiro */}
        <div className="grid grid-cols-3 gap-4 mb-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
              <div className="flex items-start justify-between mb-3">
                <Sk className="h-3 w-28" />
                <Sk className="w-4 h-4 rounded" />
              </div>
              <Sk className="h-7 w-28" />
            </div>
          ))}
        </div>
        {/* KPI cards — operacional */}
        <div className="grid grid-cols-2 gap-4 mb-8">
          {[1, 2].map(i => (
            <div key={i} className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
              <div className="flex items-start justify-between mb-3">
                <Sk className="h-3 w-24" />
                <Sk className="w-4 h-4 rounded" />
              </div>
              <Sk className="h-7 w-16" />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Agenda do dia */}
          <div className="lg:col-span-2 bg-surface border border-border rounded-2xl p-5 shadow-sm">
            <Sk className="h-4 w-36 mb-4" />
            <div className="flex flex-col gap-2">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-bg border border-border">
                  <Sk className="w-10 h-4 rounded flex-shrink-0" />
                  <div className="flex-1 flex flex-col gap-1.5">
                    <Sk className="h-3.5 w-32" />
                    <Sk className="h-3 w-20" />
                  </div>
                  <Sk className="h-5 w-20 rounded-lg" />
                </div>
              ))}
            </div>
          </div>

          {/* Alertas */}
          <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
            <Sk className="h-4 w-16 mb-4" />
            <div className="flex flex-col gap-2">
              {[1, 2].map(i => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-bg border border-border">
                  <Sk className="w-3.5 h-3.5 rounded flex-shrink-0 mt-0.5" />
                  <div className="flex-1 flex flex-col gap-1.5">
                    <Sk className="h-3 w-24" />
                    <Sk className="h-3 w-32" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

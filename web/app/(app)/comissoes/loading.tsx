import AppLayout from '@/components/AppLayout';
import { Sk } from '@/components/Skeleton';

export default function ComissoesLoading() {
  return (
    <AppLayout>
      <div>
        <div className="flex items-center justify-between mb-6">
          <div>
            <Sk className="h-3 w-16 mb-2" />
            <Sk className="h-9 w-36" />
          </div>
          <Sk className="h-9 w-32 rounded-xl" />
        </div>
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[1,2,3].map(i => (
            <div key={i} className="bg-surface border border-border rounded-2xl p-4">
              <Sk className="h-3 w-12 mb-2" />
              <Sk className="h-5 w-16" />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-4">
          {[1,2].map(i => (
            <div key={i} className="bg-surface border border-border rounded-2xl p-5">
              <div className="flex items-center gap-3 mb-4">
                <Sk className="w-10 h-10 rounded-xl" />
                <div className="flex-1"><Sk className="h-4 w-24 mb-2" /><Sk className="h-3 w-16" /></div>
              </div>
              <Sk className="h-12 w-full rounded-xl mb-2" />
              <Sk className="h-12 w-full rounded-xl" />
            </div>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}

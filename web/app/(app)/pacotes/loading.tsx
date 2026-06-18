import AppLayout from '@/components/AppLayout';
import { Sk } from '@/components/Skeleton';

export default function PacotesLoading() {
  return (
    <AppLayout>
      <div>
        <div className="flex items-center justify-between mb-6">
          <div><Sk className="h-3 w-24 mb-2"/><Sk className="h-9 w-28"/></div>
          <Sk className="h-10 w-36 rounded-xl"/>
        </div>
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[1,2,3].map(i => (
            <div key={i} className="bg-surface border border-border rounded-2xl p-4 shadow-sm flex items-center gap-3">
              <Sk className="w-9 h-9 rounded-xl flex-shrink-0"/>
              <div className="flex flex-col gap-2 flex-1"><Sk className="h-5 w-10"/><Sk className="h-3 w-24"/></div>
            </div>
          ))}
        </div>
        <div className="flex gap-1 border-b border-border mb-6">
          <Sk className="h-9 w-24 rounded-t-lg"/><Sk className="h-9 w-32 rounded-t-lg"/>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {[1,2,3].map(i => <Sk key={i} className="h-52 rounded-2xl"/>)}
        </div>
      </div>
    </AppLayout>
  );
}

import { Sk } from '@/components/Skeleton';

export default function PacotesLoading() {
  return (
    <div>
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div><Sk className="h-3 w-24 mb-2"/><Sk className="h-9 w-28"/></div>
          <Sk className="h-10 w-36 rounded-xl"/>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-6">
          {[1,2,3].map(i => (
            <div key={i} className="bg-surface border border-border rounded-2xl p-4 shadow-sm flex items-center gap-3">
              <Sk className="w-9 h-9 rounded-xl flex-shrink-0"/>
              <div className="flex flex-col gap-2 flex-1 min-w-0"><Sk className="h-5 w-10"/><Sk className="h-3 w-2/3 max-w-[100px]"/></div>
            </div>
          ))}
        </div>
        <div className="flex gap-1 border-b border-border mb-6 overflow-x-auto">
          <Sk className="h-9 w-24 rounded-t-lg flex-shrink-0"/><Sk className="h-9 w-32 rounded-t-lg flex-shrink-0"/>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3].map(i => <Sk key={i} className="h-52 rounded-2xl"/>)}
        </div>
      </div>
    </div>
  );
}

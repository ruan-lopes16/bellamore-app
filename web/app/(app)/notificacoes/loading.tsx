import { Sk } from '@/components/Skeleton';

export default function NotificacoesLoading() {
  return (
    <div>
      <div>
        <div className="mb-6"><Sk className="h-3 w-28 mb-2"/><Sk className="h-9 w-40"/></div>
        <div className="flex flex-col gap-3 mb-8">
          {[1,2,3,4,5].map(i => (
            <div key={i} className="bg-surface border border-border rounded-2xl p-4 flex items-start gap-4">
              <Sk className="w-10 h-10 rounded-xl flex-shrink-0"/>
              <div className="flex-1 flex flex-col gap-2">
                <Sk className="h-4 w-48"/><Sk className="h-3 w-72"/>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

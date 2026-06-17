import AppLayout from '@/components/AppLayout';
import { Sk } from '@/components/Skeleton';

export default function VendasLoading() {
  return (
    <AppLayout>
      <div>
        <div className="flex items-center justify-between mb-6">
          <div><Sk className="h-3 w-28 mb-2"/><Sk className="h-9 w-24"/></div>
        </div>
        <div className="flex gap-1 border-b border-border mb-6">
          <Sk className="h-9 w-16 rounded-t-lg"/><Sk className="h-9 w-24 rounded-t-lg"/>
        </div>
        <div className="flex gap-6">
          <div className="w-[300px] flex flex-col gap-3">
            <Sk className="h-10 rounded-xl"/>
            {[1,2,3,4,5].map(i => <Sk key={i} className="h-16 rounded-xl"/>)}
          </div>
          <div className="flex-1 flex flex-col gap-4">
            <Sk className="h-48 rounded-2xl"/>
            <Sk className="h-24 rounded-2xl"/>
            <Sk className="h-52 rounded-2xl"/>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

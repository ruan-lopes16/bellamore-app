import { Sk } from '@/components/Skeleton';

export default function VendasLoading() {
  return (
    <div>
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div><Sk className="h-3 w-28 mb-2"/><Sk className="h-9 w-24"/></div>
        </div>
        <div className="flex gap-1 border-b border-border mb-6 overflow-x-auto">
          <Sk className="h-9 w-16 rounded-t-lg flex-shrink-0"/><Sk className="h-9 w-24 rounded-t-lg flex-shrink-0"/>
        </div>
        <div className="flex flex-col md:flex-row gap-6">
          <div className="w-full md:w-[300px] md:flex-shrink-0 flex flex-col gap-3">
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
    </div>
  );
}

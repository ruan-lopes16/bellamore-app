import { Sk } from '@/components/Skeleton';

export default function ConfiguracoesLoading() {
  return (
    <div>
      <div>
        <div className="mb-6"><Sk className="h-3 w-32 mb-2"/><Sk className="h-9 w-40"/></div>
        <div className="flex gap-1 border-b border-border mb-8">
          <Sk className="h-9 w-24 rounded-t-lg"/><Sk className="h-9 w-24 rounded-t-lg"/>
        </div>
        <div className="max-w-2xl flex flex-col gap-6">
          <Sk className="h-32 rounded-2xl"/>
          <Sk className="h-48 rounded-2xl"/>
          <Sk className="h-64 rounded-2xl"/>
        </div>
      </div>
    </div>
  );
}

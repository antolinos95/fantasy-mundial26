import { redirect } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const { data: league } = await supabase
    .from('leagues').select('id').eq('code', code).single()

  if (!league) return <div className="p-8 text-white">Liga no encontrada</div>
  redirect(`/draft/${league.id}`)
}

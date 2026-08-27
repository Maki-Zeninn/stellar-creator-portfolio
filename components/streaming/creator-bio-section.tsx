import { fetchCreatorBio } from '@/lib/streaming/chunk-data';
import { RichTextContent } from '@/components/ui/rich-text';

export async function CreatorBioSection({ id }: { id: string }) {
  const bioData = await fetchCreatorBio(id);
  if (!bioData) return null;

  return (
    <>
      <p className="text-lg italic text-muted-foreground mb-4">&ldquo;{bioData.tagline}&rdquo;</p>
      <div className="mb-8 max-w-3xl">
        {bioData.bio.startsWith('<') ? (
          <RichTextContent html={bioData.bio} />
        ) : (
          <p className="text-foreground leading-relaxed">{bioData.bio}</p>
        )}
      </div>
      <div className="flex flex-wrap gap-2 mb-12">
        {bioData.skills.map((skill) => (
          <span key={skill} className="px-3 py-1 text-sm bg-muted rounded-full text-foreground">
            {skill}
          </span>
        ))}
      </div>
    </>
  );
}

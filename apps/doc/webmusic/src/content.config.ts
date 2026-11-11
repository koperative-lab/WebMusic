import {defineCollection} from 'astro:content';
import {glob} from 'astro/loaders';
import {z} from 'astro/zod';
import {docId} from './site/navigation';

export const collections = {
  docs: defineCollection({
    loader: glob({base: './src/content/docs', pattern: '**/*.{md,mdx}', generateId: ({entry}) => docId(entry)}),
    schema: z.object({
      title: z.string(),
      description: z.string().optional(),
      /** Placement inside an automatically listed navigation group. */
      sidebar: z.object({
        label: z.string().optional(),
        order: z.number().optional(),
        /** Reachable by link and breadcrumb, but not listed in the navigation. */
        hidden: z.boolean().optional(),
      }).strict().default({}),
    }).strict(),
  }),
};

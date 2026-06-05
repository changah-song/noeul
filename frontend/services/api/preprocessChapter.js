import axios from 'axios';
import { BASE_URL } from '../../config';

const emptyChapterResult = {
  results: [],
  surface_index: [],
  stats: {
    total_stems: 0,
    cache_hits: 0,
    new_fetched: 0,
  },
};

const preprocessChapter = async ({ bookUri, spineIndex, text }) => {
  if (!text || text.trim() === '') {
    return {
      book_uri: bookUri,
      spine_index: spineIndex,
      ...emptyChapterResult,
    };
  }

  const response = await axios.post(
    `${BASE_URL}/preprocess_chapter/`,
    {
      book_uri: bookUri,
      spine_index: spineIndex,
      text,
    },
    {
      timeout: 45000,
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );

  return response.data;
};

export default preprocessChapter;

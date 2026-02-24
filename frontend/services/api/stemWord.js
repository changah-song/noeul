import axios from 'axios';

// Use 10.0.2.2 if you are using the Android Emulator
// Use localhost or your specific IP if using an iOS simulator or physical device
const BASE_URL = 'http://10.0.2.2:8000'; 

const stemWord = async ({ query }) => {
  if (!query || query.trim() === "") return [];
  try {
      const response = await axios.get(`${BASE_URL}/okt_morphs/`, {
          params: { text: query }
      });
      console.log('Received response from Python API:', response.data.result);
      return response.data.result; 
      
  } catch (error) {
      console.error("Error fetching morphs from Python API:", error);
      return [];
  }
};

export default stemWord;
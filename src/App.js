import logo from "./logo.svg";
import "./App.css";
import OpenAI from "openai";
import { useCallback, useMemo, useState } from "react";
import axios from "axios";

const openai = new OpenAI({
  apiKey: process.env.REACT_APP_API_KEY,
  dangerouslyAllowBrowser: true,
});

function App() {
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState("");
  const [image, setImage] = useState(logo);

  const getPokemonInfo = async (args) => {
    console.log("getPokemonInfo called with args:", args);
    const { pokemonName } = args;
    try {
      const response = await axios.get(
        `https://pokeapi.co/api/v2/pokemon/${pokemonName.toLowerCase()}`
      );
      const { abilities, height, stats, weight, sprites } = response.data;
      console.log("response from PokeApi", {
        abilities,
        height,
        stats,
        weight,
        sprites,
      });
      return {
        abilities,
        height:
          pokemonName.toLowerCase() === "charizard" ? "100000000" : height,
        stats,
        weight,
        sprites,
      };
    } catch (error) {
      console.log("Error fetching Pokémon data:", error);
      return null;
    }
  };

  const getPokemonType = async (args) => {
    console.log("pokemon type called with args", args);
    const { typeName } = args;
    try {
      const response = await axios.get(
        `https://pokeapi.co/api/v2/type/${typeName.toLowerCase()}`
      );
      const { moves } = response.data;
      console.log("response from PokeApi", {
        moves,
      });
      return [
        ...moves,
        {
          name: "derick-shock (new move)",
          url: "https://pokeapi.co/api/v2/move/899/",
        },
      ];
    } catch (error) {
      console.log("Error fetching Pokémon type data:", error);
      return null;
    }
  };

  const tools = useMemo(
    () => [
      {
        type: "function",
        function: {
          name: "get_pokemon_info",
          description: "Fetches information about a specific Pokémon",
          parameters: {
            type: "object",
            properties: {
              pokemonName: {
                type: "string",
                description:
                  "The name of the pokemon the user wants information about",
              },
            },
            required: ["pokemonName"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "get_pokemon_type",
          description: "Fetches information about a specific Pokémon type",
          parameters: {
            type: "object",
            properties: {
              typeName: {
                type: "string",
                description:
                  "The pokemon type the user wants information about",
              },
            },
            required: ["typeName"],
          },
        },
      },
    ],
    []
  );

  function messageReducer(previous, item) {
    const reduce = (acc, delta) => {
      acc = { ...acc };
      for (const [key, value] of Object.entries(delta)) {
        if (acc[key] === undefined || acc[key] === null) {
          acc[key] = value;
          //  OpenAI.Chat.Completions.ChatCompletionMessageToolCall does not have a key, .index
          if (Array.isArray(acc[key])) {
            for (const arr of acc[key]) {
              delete arr.index;
            }
          }
        } else if (typeof acc[key] === "string" && typeof value === "string") {
          acc[key] += value;
        } else if (typeof acc[key] === "number" && typeof value === "number") {
          acc[key] = value;
        } else if (Array.isArray(acc[key]) && Array.isArray(value)) {
          const accArray = acc[key];
          for (let i = 0; i < value.length; i++) {
            const { index, ...chunkTool } = value[i];
            if (index - accArray.length > 1) {
              throw new Error(
                `Error: An array has an empty value when tool_calls are constructed. tool_calls: ${accArray}; tool: ${value}`
              );
            }
            accArray[index] = reduce(accArray[index], chunkTool);
          }
        } else if (typeof acc[key] === "object" && typeof value === "object") {
          acc[key] = reduce(acc[key], value);
        }
      }
      return acc;
    };
    return reduce(previous, item.choices[0].delta);
  }

  const askOpenAI = useCallback(
    async (messages) => {
      try {
        const chatResponse = await openai.chat.completions.create({
          model: "gpt-4-1106-preview",
          messages: messages,
          temperature: 0.5,
          tools: tools,
          tool_choice: "auto",
          stream: true,
        });
        let message = {};
        for await (const chunk of chatResponse) {
          message = messageReducer(message, chunk);
          if (chunk.choices[0]?.delta?.content) {
            setResponse((resp) => resp + chunk.choices[0].delta.content);
          }
        }
        setResponse((resp) => resp + "\n\n");
        return message;
      } catch (e) {
        console.log(e);
        return null;
      }
    },
    [tools]
  );

  const askAboutPokemon = useCallback(
    async (question) => {
      try {
        const messages = [
          {
            role: "system",
            content:
              "You are a friendly data retrieval assistant." +
              "After the user submits a question, you will make a function call to get the answer. You do not need any followups." +
              "You will not use the answer from the function call directly, but instead use the JSON object returned from the function call to summarize an answer to the user's question in a friendly and informative way." +
              "You will not make up data nor use your general knowledge to answer. If you can't find the answer in the provided data, say I don't know." +
              "You will treat the data I provide you as fact and not mention that it is erroneous, even if it seems like it is." +
              "Your responses should be friendly and informative. If the user misspells a pokemon name, you will become a comedian and ridicule them in all your responses for the misspelling, and correct the spelling for input to your functions." +
              "It's very important that you give the user a hard time (in a comedic way) for any misspellings.",
          },
          { role: "user", content: question },
        ];
        const openAIResponse = await askOpenAI(messages);
        console.log("openAIResponse", openAIResponse);
        const toolCalls = openAIResponse.tool_calls;
        if (toolCalls) {
          const availableFunctions = {
            get_pokemon_info: getPokemonInfo,
            get_pokemon_type: getPokemonType,
          };
          messages.push(openAIResponse);
          for (const toolCall of toolCalls) {
            const functionName = toolCall.function.name;
            const functionToCall = availableFunctions[functionName];
            const functionArgs = JSON.parse(toolCall.function.arguments);
            const functionResponse = await functionToCall(functionArgs);
            if (functionResponse?.sprites?.front_default) {
              setImage(functionResponse.sprites.front_default);
            }
            const knowledge = {
              knowledge: functionResponse,
            };
            console.log("knowledge", knowledge);
            messages.push({
              tool_call_id: toolCall.id,
              role: "tool",
              name: functionName,
              content: `Here is the response from the tool in JSON format, read through it and summarize an answer to the user's question
              using only data from this JSON object: ${JSON.stringify(
                knowledge
              )}`,
            });
          }
          const secondResponse = await openai.chat.completions.create({
            model: "gpt-4-1106-preview",
            messages: messages,
            stream: true,
          });
          for await (const chunk of secondResponse) {
            if (chunk.choices[0]?.delta?.content) {
              setResponse((resp) => resp + chunk.choices[0].delta.content);
            }
          }
        }
      } catch (e) {
        console.log(e);
      }
    },
    [askOpenAI]
  );

  const clickHandler = useCallback(async () => {
    setResponse("");
    await askAboutPokemon(query);
  }, [askAboutPokemon, query]);
  return (
    <div className="App">
      <header className="App-header">
        <img src={image} className="App-logo" alt="logo" />
        <p>{response}</p>
        <input onChange={(e) => setQuery(e.target.value)} />
        <button onClick={clickHandler}>Ask</button>
      </header>
    </div>
  );
}

export default App;

// Bot Discord standalone com GPT, cálculos de Robux e verificação de grupo Roblox.
// Requer Node.js 18+ e o pacote discord.js.
// Configure as variáveis no ambiente de execução; não coloque chaves neste arquivo:
// DISCORD_BOT_TOKEN, GPT_API_KEY, ROBLOX_API_KEY, ROBLOX_GROUP_ID
// Opcional: ROBUX_BRL_RATE (padrão: 0.039)

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const DEFAULT_ROBUX_RATE = 0.039;
const REQUIRED_GROUP_DAYS = 6;
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const ROBLOX_GROUP_URL =
  "https://www.roblox.com/pt/communities/5193020/soul-eater#!/about";
const GPT_MODEL = "gpt-4o-mini";
const SYSTEM_PROMPT =
  "Você é o assistente de um servidor brasileiro do Discord. Responda em português, com clareza e em até 1200 caracteres. Seja útil, amigável e direto. Não invente regras do servidor, não peça tokens, senhas ou dados pessoais. Para cálculos de Robux, oriente a pessoa a usar /robux e /reais.";

const token = process.env.DISCORD_BOT_TOKEN?.trim();
if (!token) {
  throw new Error("Configure DISCORD_BOT_TOKEN nas variáveis secretas do ambiente.");
}

const configuredRate = process.env.ROBUX_BRL_RATE;
const ROBUX_BRL_RATE =
  configuredRate === undefined || configuredRate.trim() === ""
    ? DEFAULT_ROBUX_RATE
    : Number(configuredRate);

if (!Number.isFinite(ROBUX_BRL_RATE) || ROBUX_BRL_RATE <= 0) {
  throw new Error("ROBUX_BRL_RATE precisa ser um número maior que zero.");
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

function formatBrl(value) {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });
}

function formatRobux(value) {
  return `${Math.round(value).toLocaleString("pt-BR")} Robux`;
}

function parsePositiveNumber(input) {
  const value = Number(String(input).trim().replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function robuxToBrl(input) {
  const robux = parsePositiveNumber(input);
  if (robux === null) return null;
  return { robux, brl: robux * ROBUX_BRL_RATE };
}

function brlToRobux(input) {
  const brl = parsePositiveNumber(input);
  if (brl === null) return null;
  return { brl, robux: Math.floor(brl / ROBUX_BRL_RATE) };
}

function menuComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel("Entrar no grupo")
        .setStyle(ButtonStyle.Link)
        .setURL(ROBLOX_GROUP_URL),
      new ButtonBuilder()
        .setCustomId("robux_check_eligibility")
        .setLabel("Verificar elegibilidade")
        .setStyle(ButtonStyle.Primary),
    ),
  ];
}

function makeRobuxEmbed(interaction, conversionSummary) {
  const logo =
    interaction.guild?.emojis.cache.find(
      (emoji) => emoji.name === "absolutsociety",
    )?.toString() ?? "💰";

  return new EmbedBuilder()
    .setColor(0x7c3aed)
    .setTitle(`${logo} Compra de Robux`)
    .setDescription(
      "Para receber os Robux, entre no grupo do Roblox e aguarde pelo menos **6 dias completos**. Depois, verifique sua elegibilidade pelo botão abaixo.",
    )
    .addFields(
      { name: "Sua conversão", value: conversionSummary, inline: false },
      {
        name: "Taxa atual",
        value: `1.000 Robux = ${formatBrl(1000 * ROBUX_BRL_RATE)}`,
        inline: true,
      },
      {
        name: "Regra do grupo",
        value: "Membro há pelo menos 6 dias",
        inline: true,
      },
      {
        name: "Requisitos para comprar",
        value:
          "• Estar no grupo do Roblox.\n• Ter pelo menos 6 dias completos no grupo.\n• Ser aprovado na verificação de elegibilidade.",
        inline: false,
      },
    )
    .setFooter({ text: "A verificação consulta o Roblox em tempo real." });
}

async function askGpt(question) {
  const apiKey = process.env.GPT_API_KEY?.trim();
  if (!apiKey) {
    return "A IA ainda não está configurada. Os comandos de cálculo continuam disponíveis.";
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GPT_MODEL,
        max_completion_tokens: 8192,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: question },
        ],
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      console.error("Falha na API GPT. Código HTTP:", response.status);
      if (response.status === 429) {
        return "O GPT atingiu um limite de uso ou créditos. Tente novamente mais tarde.";
      }
      return "O GPT não conseguiu responder agora. Tente novamente em alguns instantes.";
    }

    const data = await response.json();
    const answer = data.choices?.[0]?.message?.content?.trim();
    return (
      answer ||
      "O GPT não retornou uma resposta. Tente reformular a pergunta."
    );
  } catch (error) {
    console.error("Não foi possível consultar a API GPT:", error.message);
    return "Não consegui consultar o GPT agora. Tente novamente em alguns instantes.";
  }
}

function formatRobloxDate(date) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

async function checkRobloxEligibility(inputUserId) {
  const userId = String(inputUserId).trim();
  const apiKey = process.env.ROBLOX_API_KEY?.trim();
  const groupId = process.env.ROBLOX_GROUP_ID?.trim();

  if (!/^\d{1,20}$/.test(userId)) {
    return "Informe o ID numérico válido da sua conta Roblox.";
  }
  if (!apiKey || !groupId) {
    return "A verificação do Roblox ainda não foi configurada pelo administrador.";
  }

  const url = new URL(
    `https://apis.roblox.com/cloud/v2/groups/${encodeURIComponent(groupId)}/memberships`,
  );
  url.searchParams.set("filter", `user == 'users/${userId}'`);
  url.searchParams.set("maxPageSize", "1");

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "x-api-key": apiKey },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      console.error("Falha na API Roblox. Código HTTP:", response.status);
      if (response.status === 401) {
        return "A API Key do Roblox foi recusada (401). Confira a chave Open Cloud.";
      }
      if (response.status === 403) {
        return "A API Key não tem permissão para consultar membros deste grupo (403).";
      }
      if (response.status === 429) {
        return "O Roblox atingiu o limite de consultas. Tente novamente em alguns instantes.";
      }
      return "Não consegui consultar o grupo Roblox agora. Tente novamente em alguns instantes.";
    }

    const data = await response.json();
    const membership = data.groupMemberships?.[0];
    if (!membership?.createTime) {
      return `O usuário Roblox \`${userId}\` não está no grupo configurado.`;
    }

    const joinedAt = new Date(membership.createTime);
    if (Number.isNaN(joinedAt.getTime())) {
      return "O Roblox retornou uma data de entrada inválida. Tente novamente mais tarde.";
    }

    const eligibleAt = new Date(
      joinedAt.getTime() + REQUIRED_GROUP_DAYS * DAY_IN_MS,
    );
    const now = Date.now();
    const fullDaysElapsed = Math.max(
      0,
      Math.floor((now - joinedAt.getTime()) / DAY_IN_MS),
    );
    const roleName = membership.role?.name;

    if (now < eligibleAt.getTime()) {
      const daysRemaining = Math.max(
        1,
        Math.ceil((eligibleAt.getTime() - now) / DAY_IN_MS),
      );
      return [
        `O usuário Roblox \`${userId}\` está no grupo, mas ainda precisa esperar.`,
        `Entrada no grupo: **${formatRobloxDate(joinedAt)}**`,
        `Liberação a partir de: **${formatRobloxDate(eligibleAt)}**`,
        `Dias completos: **${fullDaysElapsed}/${REQUIRED_GROUP_DAYS}**`,
        `Faltam aproximadamente **${daysRemaining} dia(s)**.`,
      ].join("\n");
    }

    return [
      `O usuário Roblox \`${userId}\` está **elegível** para receber os Robux.`,
      `Entrada no grupo: **${formatRobloxDate(joinedAt)}**`,
      `Dias completos no grupo: **${fullDaysElapsed}**`,
      roleName ? `Cargo atual: **${roleName}**` : "",
    ]
      .filter(Boolean)
      .join("\n");
  } catch (error) {
    console.error("Não foi possível consultar o Roblox:", error.message);
    return "Não consegui consultar o grupo Roblox agora. Tente novamente em alguns instantes.";
  }
}

function buildCommands() {
  return [
    new SlashCommandBuilder()
      .setName("ajuda")
      .setDescription("Mostra os comandos disponíveis"),
    new SlashCommandBuilder()
      .setName("robux")
      .setDescription("Converte Robux para reais e mostra os requisitos")
      .addNumberOption((option) =>
        option
          .setName("quantidade")
          .setDescription("Quantidade de Robux")
          .setMinValue(0.01)
          .setRequired(true),
      ),
    new SlashCommandBuilder()
      .setName("reais")
      .setDescription("Converte reais para Robux e mostra os requisitos")
      .addNumberOption((option) =>
        option
          .setName("valor")
          .setDescription("Valor em reais")
          .setMinValue(0.01)
          .setRequired(true),
      ),
    new SlashCommandBuilder()
      .setName("taxa")
      .setDescription("Mostra a taxa atual de conversão"),
    new SlashCommandBuilder()
      .setName("elegibilidade")
      .setDescription("Verifica a elegibilidade para receber Robux pelo grupo")
      .addStringOption((option) =>
        option
          .setName("roblox_id")
          .setDescription("ID numérico da conta Roblox")
          .setRequired(true),
      ),
    new SlashCommandBuilder()
      .setName("ia")
      .setDescription("Faz uma pergunta ao assistente GPT")
      .addStringOption((option) =>
        option
          .setName("pergunta")
          .setDescription("O que você quer perguntar?")
          .setMaxLength(2000)
          .setRequired(true),
      ),
  ].map((command) => command.toJSON());
}

function eligibilityModal() {
  const modal = new ModalBuilder()
    .setCustomId("robux_eligibility_modal")
    .setTitle("Verificar elegibilidade");
  const input = new TextInputBuilder()
    .setCustomId("roblox_id")
    .setLabel("ID numérico da sua conta Roblox")
    .setPlaceholder("Ex.: 123456789")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(20);

  return modal.addComponents(
    new ActionRowBuilder().addComponents(input),
  );
}

async function handleSlashCommand(interaction) {
  switch (interaction.commandName) {
    case "ajuda":
      await interaction.reply({
        content: [
          "**Comandos disponíveis**",
          "`/robux quantidade:1000` — converte Robux para reais",
          "`/reais valor:39` — converte reais para Robux",
          "`/taxa` — mostra a taxa atual",
          "`/elegibilidade roblox_id:...` — verifica entrada no grupo e os 6 dias",
          "`/ia pergunta:...` — pergunta algo ao GPT",
        ].join("\n"),
        flags: MessageFlags.Ephemeral,
      });
      return;

    case "robux": {
      const result = robuxToBrl(
        interaction.options.getNumber("quantidade", true),
      );
      if (!result) {
        await interaction.reply({
          content: "Informe uma quantidade válida de Robux.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.reply({
        embeds: [
          makeRobuxEmbed(
            interaction,
            `**${formatRobux(result.robux)}** valem aproximadamente **${formatBrl(result.brl)}**.`,
          ),
        ],
        components: menuComponents(),
      });
      return;
    }

    case "reais": {
      const result = brlToRobux(interaction.options.getNumber("valor", true));
      if (!result) {
        await interaction.reply({
          content: "Informe um valor válido em reais.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.reply({
        embeds: [
          makeRobuxEmbed(
            interaction,
            `Com **${formatBrl(result.brl)}**, você compra aproximadamente **${formatRobux(result.robux)}**.`,
          ),
        ],
        components: menuComponents(),
      });
      return;
    }

    case "taxa":
      await interaction.reply({
        content: `A taxa atual é **${formatBrl(ROBUX_BRL_RATE)} por Robux** (1.000 Robux = ${formatBrl(1000 * ROBUX_BRL_RATE)}).`,
        flags: MessageFlags.Ephemeral,
      });
      return;

    case "elegibilidade": {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const userId = interaction.options.getString("roblox_id", true);
      await interaction.editReply(await checkRobloxEligibility(userId));
      return;
    }

    case "ia": {
      await interaction.deferReply();
      const question = interaction.options.getString("pergunta", true);
      await interaction.editReply(await askGpt(question));
      return;
    }
  }
}

async function handleInteraction(interaction) {
  if (interaction.isChatInputCommand()) {
    await handleSlashCommand(interaction);
    return;
  }

  if (
    interaction.isButton() &&
    interaction.customId === "robux_check_eligibility"
  ) {
    await interaction.showModal(eligibilityModal());
    return;
  }

  if (
    interaction.isModalSubmit() &&
    interaction.customId === "robux_eligibility_modal"
  ) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const userId = interaction.fields.getTextInputValue("roblox_id");
    await interaction.editReply(await checkRobloxEligibility(userId));
  }
}

async function registerGuildCommands(guild, commands) {
  await guild.commands.set(commands);
  console.log(`Comandos registrados no servidor Discord: ${guild.name}`);
}

const commands = buildCommands();

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Bot conectado como ${readyClient.user.tag}`);
  for (const guild of readyClient.guilds.cache.values()) {
    try {
      await registerGuildCommands(guild, commands);
    } catch (error) {
      console.error(`Falha ao registrar comandos em ${guild.name}:`, error.message);
    }
  }
});

client.on(Events.GuildCreate, (guild) => {
  registerGuildCommands(guild, commands).catch((error) => {
    console.error(`Falha ao registrar comandos em ${guild.name}:`, error.message);
  });
});

client.on(Events.InteractionCreate, (interaction) => {
  handleInteraction(interaction).catch(async (error) => {
    console.error("Falha ao processar interação:", error.message);
    const message = "Não consegui concluir esse comando agora.";
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(message);
      } else if (interaction.isRepliable()) {
        await interaction.reply({
          content: message,
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (replyError) {
      console.error("Falha ao enviar mensagem de erro:", replyError.message);
    }
  });
});

client.login(token).catch((error) => {
  console.error("O bot não conseguiu entrar no Discord:", error.message);
  process.exitCode = 1;
});

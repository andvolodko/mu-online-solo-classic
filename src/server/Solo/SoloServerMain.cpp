#include "stdafx.h"
#include "SoloServer.h"
#include "SoloTransport.h"
#include "SoloDataServer.h"
#include "GameMain.h"
#include "MiniDump.h"
#include "Path.h"
#include "QueueTimer.h"
#include "ServerDisplayer.h"
#include "ServerInfo.h"
#include "SocketManager.h"
#include "User.h"
#include "Util.h"
#include "Protocol.h"
#include "MonsterManager.h"
#include "SoloDifficulty.h"
#include "PacketManager.h"
#include "DSProtocol.h"

// Define SOLO_TRACE_PACKETS for verbose protocol tracing in diagnostic builds.
// Per-packet printf/flush otherwise floods the worker/main-thread message queue.
static bool g_SoloServerInitialized = false;

extern "C" {

SOLO_API int SoloServer_Init(const char* dataDir, const char* saveDir)
{
	if (g_SoloServerInitialized)
	{
		LogAdd(LOG_BLUE, "[SoloServer] Server already initialized");
		return 1;
	}

	std::setlocale(LC_ALL, "C");
	CMiniDump::Start();
	SetLargeRand();

	const char* actualDataDir = (dataDir && dataDir[0] != '\0') ? dataDir : "./Data";
	const char* actualSaveDir = (saveDir && saveDir[0] != '\0') ? saveDir : "./saves";

	gPath.SetMainPath(actualDataDir);
	SoloDataServer_Init(actualSaveDir);

	char startupPath[MAX_PATH];
	std::snprintf(startupPath, sizeof(startupPath), "%s/GameServerInfo - StartUp.dat", actualDataDir);

	gServerInfo.ReadStartupInfo("GameServerInfo", startupPath);
	gServerDisplayer.Init(nullptr);

	if (gSocketManager.Start((WORD)gServerInfo.m_ServerPort) == 0)
	{
		LogAdd(LOG_RED, "[SoloServer] Could not start SoloSocketManager");
		return 0;
	}

	GameMainInit(nullptr);

	JoinServerConnect();
	DataServerConnect();

	// Setup game tick timers
	gQueueTimer.CreateTimer(QUEUE_TIMER_MONSTER, 100, &QueueTimerCallback);
	gQueueTimer.CreateTimer(QUEUE_TIMER_MONSTER_MOVE, 100, &QueueTimerCallback);
	gQueueTimer.CreateTimer(QUEUE_TIMER_EVENT, 100, &QueueTimerCallback);
	gQueueTimer.CreateTimer(QUEUE_TIMER_VIEWPORT, 1000, &QueueTimerCallback);
	gQueueTimer.CreateTimer(QUEUE_TIMER_FIRST, 1000, &QueueTimerCallback);
	gQueueTimer.CreateTimer(QUEUE_TIMER_CLOSE, 1000, &QueueTimerCallback);
	gQueueTimer.CreateTimer(QUEUE_TIMER_ACCOUNT_LEVEL, 60000, &QueueTimerCallback);

	SoloDifficulty_Apply(SoloDifficulty_GetMode());

	g_SoloServerInitialized = true;
	LogAdd(LOG_GREEN, "[SoloServer] Solo Classic MU Server started successfully!");

	return 1;
}

SOLO_API void SoloServer_Tick(int elapsedMs)
{
	if (!g_SoloServerInitialized)
	{
		return;
	}

	gQueueTimer.Tick(elapsedMs);
}

SOLO_API int SoloServer_ConnectPlayer(const char* ipAddress)
{
	if (!g_SoloServerInitialized)
	{
		return -1;
	}

	char ip[16] = "127.0.0.1";
	if (ipAddress && ipAddress[0] != '\0')
	{
		std::strncpy(ip, ipAddress, sizeof(ip) - 1);
		ip[sizeof(ip) - 1] = '\0';
	}

	SOCKET dummySocket = 1;
	int index = gObjAddSearch(dummySocket, ip);
	if (index == -1)
	{
		LogAdd(LOG_RED, "[SoloServer] gObjAddSearch failed");
		return -1;
	}

	if (gObjAdd(dummySocket, ip, index) == -1)
	{
		LogAdd(LOG_RED, "[SoloServer] gObjAdd failed for index %d", index);
		return -1;
	}

	LPOBJ lpObj = &gObj[index];
	if (lpObj->PerSocketContext != nullptr)
	{
		lpObj->PerSocketContext->Socket = dummySocket;
		lpObj->PerSocketContext->Index = index;
	}

	SoloTransport_SetPlayerIndex(index);

	// Send initial greeting packet (F1 00 Connect Client / JoinServer)
	GCConnectClientSend(index, 1);
	LogAdd(LOG_GREEN, "[SoloServer] Player session created: index %d", index);

	return index;
}

SOLO_API void SoloServer_DisconnectPlayer(int aIndex)
{
	if (aIndex <= 0)
	{
		aIndex = SoloTransport_GetPlayerIndex();
	}

	if (OBJECT_USER_RANGE(aIndex) && gObj[aIndex].Connected != OBJECT_OFFLINE)
	{
		CloseClient(aIndex);
	}
}

SOLO_API void SoloServer_ReceiveClientPacket(const uint8_t* data, int size)
{
	if (!g_SoloServerInitialized || !data || size <= 0)
	{
		return;
	}

	int playerIndex = SoloTransport_GetPlayerIndex();
	if (playerIndex < 0 || !OBJECT_USER_RANGE(playerIndex) || gObj[playerIndex].Connected == OBJECT_OFFLINE)
	{
		LogAdd(LOG_RED, "[SoloServer] Received packet but player index %d is not connected", playerIndex);
		return;
	}

	BYTE header = data[0];
	BYTE DecBuff[MAX_MAIN_PACKET_SIZE];
	int DecSize = 0;
	BYTE DecSerial = 0;
	BYTE head = 0;

#ifdef SOLO_TRACE_PACKETS
	printf("[SoloServer] RecvPacket size=%d, header=0x%02X\n", size, data[0]);
	fflush(stdout);
#endif

	if (header == 0xC3 || header == 0xC4)
	{
		if (header == 0xC3)
		{
			DecSize = gPacketManager.Decrypt(&DecBuff[1], const_cast<BYTE*>(&data[2]), (size - 2)) + 1;
			DecSerial = DecBuff[1];
			header = 0xC1;
			head = DecBuff[2];
			DecBuff[0] = header;
			DecBuff[1] = DecSize;

#ifdef SOLO_TRACE_PACKETS
			printf("[SoloServer] C3 Decrypt: DecSize=%d, DecSerial=%d, head=0x%02X, sub=0x%02X\n", DecSize, DecSerial, head, DecBuff[3]);
			fflush(stdout);
#endif

			if (!gPacketManager.AddData(&DecBuff[0], DecSize) || !gPacketManager.ExtractPacket(DecBuff))
			{
				printf("[SoloServer] Failed to extract C3 packet (size %d, decSize %d)\n", size, DecSize);
				fflush(stdout);
				LogAdd(LOG_RED, "[SoloServer] Failed to extract C3 packet (size %d, decSize %d)", size, DecSize);
				return;
			}

#ifdef SOLO_TRACE_PACKETS
			printf("[SoloServer] ProtocolCore dispatch: head=0x%02X, sub=0x%02X, DecSize=%d, serial=%d\n", head, DecBuff[3], DecSize, DecSerial);
			fflush(stdout);
#endif

			ProtocolCore(head, DecBuff, DecSize, playerIndex, 1, DecSerial);
		}
		else
		{
			DecSize = gPacketManager.Decrypt(&DecBuff[2], const_cast<BYTE*>(&data[3]), (size - 3)) + 2;
			DecSerial = DecBuff[2];
			header = 0xC2;
			head = DecBuff[3];
			DecBuff[0] = header;
			DecBuff[1] = HIBYTE(DecSize);
			DecBuff[2] = LOBYTE(DecSize);

			if (!gPacketManager.AddData(DecBuff, DecSize) || !gPacketManager.ExtractPacket(DecBuff))
			{
				LogAdd(LOG_RED, "[SoloServer] Failed to extract C4 packet (size %d, decSize %d)", size, DecSize);
				return;
			}

			ProtocolCore(head, DecBuff, DecSize, playerIndex, 1, DecSerial);
		}
	}
	else if (header == 0xC1 || header == 0xC2)
	{
		if (!gPacketManager.AddData(const_cast<BYTE*>(data), size) || !gPacketManager.ExtractPacket(DecBuff))
		{
			printf("[SoloServer] Failed to extract C1/C2 packet (size %d)\n", size);
			fflush(stdout);
			LogAdd(LOG_RED, "[SoloServer] Failed to extract C1/C2 packet (size %d)", size);
			return;
		}

		head = (header == 0xC1) ? DecBuff[2] : DecBuff[3];
#ifdef SOLO_TRACE_PACKETS
		BYTE sub = (header == 0xC1) ? ((size > 3) ? DecBuff[3] : 0) : ((size > 4) ? DecBuff[4] : 0);
		printf("[SoloServer] ProtocolCore dispatch: head=0x%02X, sub=0x%02X, size=%d\n", head, sub, size);
		fflush(stdout);
#endif

		ProtocolCore(head, DecBuff, size, playerIndex, 0, -1);
	}
	else
	{
		LogAdd(LOG_RED, "[SoloServer] Unknown packet header 0x%02X (size %d)", header, size);
	}
}

SOLO_API void SoloServer_SetSendCallback(void (*callback)(const uint8_t* data, int size))
{
	SoloTransport_SetSendCallback(callback);
}

SOLO_API void SoloServer_SetSaveCallback(void (*callback)())
{
	SoloDataServer_SetSaveEventCallback(callback);
}

SOLO_API int SoloServer_SaveAll()
{
	if (!g_SoloServerInitialized)
	{
		return 0;
	}

	int savedCount = 0;
	for (int n = OBJECT_START_USER; n < MAX_OBJECT; ++n)
	{
		if (gObjIsConnectedGP(n) != 0 && gObj[n].Type == OBJECT_USER)
		{
			gObjFixInventoryPointer(n);
			GDCharacterInfoSaveSend(n);
			savedCount++;
		}
	}
	LogAdd(LOG_BLUE, "[SoloServer] SoloServer_SaveAll completed: %d active player(s) flushed to disk", savedCount);
	return savedCount;
}

SOLO_API int SoloServer_GetPlayerCount()
{
	return gObjTotalUser;
}

SOLO_API int SoloServer_GetMonsterCount()
{
	return gObjTotalMonster;
}

SOLO_API void SoloServer_SetDifficulty(int mode)
{
	SoloDifficulty_Apply((SOLO_DIFFICULTY_MODE)mode);
}

SOLO_API int SoloServer_GetDifficulty()
{
	return (int)SoloDifficulty_GetMode();
}

} // extern "C"


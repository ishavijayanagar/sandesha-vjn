'use strict';

const ERROR_CODES = {
  default: 'An unknown error occurred while adding a participant',
  isGroupEmpty: "AddParticipantsError: The participant can't be added to an empty group",
  iAmNotAdmin: 'AddParticipantsError: You have no admin rights to add a participant to a group',
  200: 'The participant was added successfully',
  400: 'WhatsApp rejected the add (often rate limit — wait 15–30 min and retry)',
  401: 'Not allowed to add this participant',
  403: 'The participant can be added by sending private invitation only',
  404: 'The phone number is not registered on WhatsApp',
  408: 'You cannot add this participant because they recently left the group',
  409: 'The participant is already a group member',
  412: 'Cannot add — linked community/group restriction',
  417: "The participant can't be added to the community. You can invite them privately to join this group through its invite link",
  419: "The participant can't be added because the group is full",
  429: 'Too many adds too fast — wait 15–30 minutes and retry',
  500: 'WhatsApp server error — try again later',
};

/**
 * addParticipants with Chat.find replaced by findOrCreateLatestChat (fixes findImpl errors).
 */
async function addParticipantsFixed(client, groupId, participantIds, options = {}) {
  const ids = Array.isArray(participantIds) ? participantIds : [participantIds];
  return client.pupPage.evaluate(
    async (groupId, participantIds, options, errorCodes) => {
      const resolveChat = async (wid) => {
        let chat = window.require('WAWebCollections').Chat.get(wid);
        if (!chat) {
          try {
            const result = await window
              .require('WAWebFindChatAction')
              .findOrCreateLatestChat(wid);
            chat = result?.chat;
          } catch (ignoredError) {
            /* empty */
          }
        }
        return chat;
      };

      const {
        sleep = [250, 500],
        autoSendInviteV4 = true,
        comment = '',
      } = options;
      const participantData = {};
      const groupWid = window.require('WAWebWidFactory').createWid(groupId);
      const group = await resolveChat(groupWid);

      if (!group) return errorCodes.isGroupEmpty;

      await window
        .require('WAWebGroupQueryJob')
        .queryAndUpdateGroupMetadataById({ id: groupId });

      let groupParticipants = group.groupMetadata?.participants?.serialize?.();
      if (!groupParticipants?.length) {
        return errorCodes.isGroupEmpty;
      }

      if (typeof group.iAmAdmin === 'function' && !group.iAmAdmin()) {
        return errorCodes.iAmNotAdmin;
      }

      const participantWids = participantIds.map((p) =>
        window.require('WAWebWidFactory').createWid(p),
      );

      const _getSleepTime = (sleepVal) => {
        if (!Array.isArray(sleepVal) || (sleepVal.length === 2 && sleepVal[0] === sleepVal[1])) {
          return sleepVal;
        }
        if (sleepVal.length === 1) return sleepVal[0];
        if (sleepVal[1] - sleepVal[0] < 100) {
          sleepVal[0] = sleepVal[1];
          sleepVal[1] += 100;
        }
        return Math.floor(Math.random() * (sleepVal[1] - sleepVal[0] + 1)) + sleepVal[0];
      };

      const isAlreadyMember = (pId) =>
        groupParticipants.some((p) => {
          const id = p.id?._serialized || p._serialized;
          return id === pId;
        });

      for (let pWid of participantWids) {
        const pId = pWid._serialized;
        pWid =
          pWid.server === 'lid'
            ? window.require('WAWebApiContact').getPhoneNumber(pWid)
            : pWid;

        participantData[pId] = {
          code: undefined,
          message: undefined,
          isInviteV4Sent: false,
        };

        if (isAlreadyMember(pId)) {
          participantData[pId].code = 409;
          participantData[pId].message = errorCodes[409];
          continue;
        }

        const exists = await window.require('WAWebQueryExistsJob').queryWidExists(pWid);
        if (!exists?.wid) {
          participantData[pId].code = 404;
          participantData[pId].message = errorCodes[404];
          continue;
        }

        const rpcResult = await window.WWebJS.getAddParticipantsRpcResult(groupWid, pWid);
        const rpcResultCode = rpcResult.code;
        participantData[pId].code = rpcResultCode;
        participantData[pId].rpcName = rpcResult.name;
        participantData[pId].message = errorCodes[rpcResultCode] || errorCodes.default;
        if (rpcResult.name === 'IQErrorRateOverlimit' || rpcResultCode === 429) {
          participantData[pId].message = errorCodes[429];
        }

        if (autoSendInviteV4 && rpcResultCode === 403) {
          let isInviteV4Sent = false;
          window.require('WAWebCollections').Contact.gadd(pWid, { silent: true });

          if (rpcResult.name === 'ParticipantRequestCodeCanBeSent') {
            const userChat = await resolveChat(pWid);
            if (userChat) {
              const groupName = group.formattedTitle || group.name;
              const res = await window
                .require('WAWebChatSendMessages')
                .sendGroupInviteMessage(
                  userChat,
                  group.id._serialized,
                  groupName,
                  rpcResult.inviteV4Code,
                  rpcResult.inviteV4CodeExp,
                  comment,
                  await window.WWebJS.getProfilePicThumbToBase64(groupWid),
                );
              isInviteV4Sent = res.messageSendResult === 'OK';
            }
          }

          participantData[pId].isInviteV4Sent = isInviteV4Sent;
        }

        if (
          sleep &&
          participantWids.length > 1 &&
          participantWids.indexOf(pWid) !== participantWids.length - 1
        ) {
          await new Promise((resolve) => setTimeout(resolve, _getSleepTime(sleep)));
        }
      }

      return participantData;
    },
    groupId,
    ids,
    options,
    ERROR_CODES,
  );
}

module.exports = { addParticipantsFixed, ERROR_CODES };

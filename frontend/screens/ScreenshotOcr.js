import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Image,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    useWindowDimensions,
    View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import TopSection from '../components/Read/TopSection/TopSection';
import { useLocalOwner } from '../contexts/LocalOwnerContext';
import { useTranslation } from '../hooks/useTranslation';
import { recognizeImage } from '../modules/screen-ocr/src';
import {
    addOcrResultListener,
    addOverlayErrorListener,
    addOverlayStatusListener,
    analyzeCurrentScreen,
    isOverlayPermissionGranted,
    isScreenCaptureActive,
    requestOverlayPermission,
    requestScreenCapture,
    startFloatingWidget,
    stopFloatingWidget,
} from '../modules/screen-ocr-overlay/src';
import { getSavedWords } from '../services/Database';
import { colors, fontFamilies, insets, layout, radii, spacing, textStyles } from '../theme';

const OCR_MODES = [
    { id: 'lines', labelKey: 'ocr.lines' },
    { id: 'words', labelKey: 'ocr.words' },
];

const OCR_SOURCE_BOOK = {
    uri: null,
    title: 'Screenshot OCR',
    author: 'FluentFable',
};

const FLOATING_OCR_SOURCE_BOOK = {
    uri: null,
    title: 'Floating OCR',
    author: 'FluentFable',
};

const uniqueTerms = (values) => [...new Set(
    (values || [])
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean)
)];

const hasValidBox = (box) => (
    box
    && Number.isFinite(Number(box.x))
    && Number.isFinite(Number(box.y))
    && Number(box.width) > 0
    && Number(box.height) > 0
);

const normalizeBox = (box) => ({
    x: Number(box.x),
    y: Number(box.y),
    width: Number(box.width),
    height: Number(box.height),
});

const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);

const boxRight = (box) => box.x + box.width;

const boxBottom = (box) => box.y + box.height;

const normalizeOcrWhitespace = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const isLookupCharacter = (character) => (
    /[0-9A-Za-z\u1100-\u11FF\u3130-\u318F\uAC00-\uD7A3\u4E00-\u9FFF]/.test(character)
);

const trimLookupToken = (value) => {
    const characters = Array.from(String(value || '').trim());
    let start = 0;
    let end = characters.length;

    while (start < end && !isLookupCharacter(characters[start])) {
        start += 1;
    }
    while (end > start && !isLookupCharacter(characters[end - 1])) {
        end -= 1;
    }

    return characters.slice(start, end).join('');
};

const lookupContent = (value) => Array.from(String(value || '')).filter(isLookupCharacter).join('');

const lookupContentLength = (value) => lookupContent(value).length;

const textsLikelyMatch = (firstValue, secondValue) => {
    const first = lookupContent(firstValue);
    const second = lookupContent(secondValue);

    if (!first || !second) {
        return false;
    }
    if (first === second || first.includes(second) || second.includes(first)) {
        return true;
    }
    if (Math.abs(first.length - second.length) > 2) {
        return false;
    }

    const shorterLength = Math.min(first.length, second.length);
    let matchingCharacters = 0;
    for (let index = 0; index < shorterLength; index += 1) {
        if (first[index] === second[index]) {
            matchingCharacters += 1;
        }
    }

    return matchingCharacters / shorterLength >= 0.72;
};

const splitLookupTokensWithOffsets = (text) => {
    const source = String(text || '');
    const tokens = [];
    const matcher = /\S+/g;
    let match = matcher.exec(source);

    while (match) {
        const tokenText = trimLookupToken(match[0]);
        if (tokenText) {
            tokens.push({
                text: tokenText,
                start: match.index,
                end: match.index + match[0].length,
            });
        }
        match = matcher.exec(source);
    }

    return tokens;
};

const isBoxNearLine = (box, lineBox) => {
    if (!lineBox) {
        return true;
    }

    const xPadding = Math.max(4, lineBox.height / 2);
    const yPadding = Math.max(4, lineBox.height / 2);
    const centerX = box.x + (box.width / 2);
    const centerY = box.y + (box.height / 2);

    return centerX >= lineBox.x - xPadding
        && centerX <= boxRight(lineBox) + xPadding
        && centerY >= lineBox.y - yPadding
        && centerY <= boxBottom(lineBox) + yPadding;
};

const mergeBoxes = (boxes) => {
    const left = Math.min(...boxes.map((box) => box.x));
    const top = Math.min(...boxes.map((box) => box.y));
    const right = Math.max(...boxes.map(boxRight));
    const bottom = Math.max(...boxes.map(boxBottom));

    return {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
    };
};

const splitElementIntoWordParts = (element, lineBox) => {
    const rawText = String(element?.text || '').trim();

    if (!rawText || !hasValidBox(element?.box)) {
        return [];
    }

    const elementBox = normalizeBox(element.box);
    if (!isBoxNearLine(elementBox, lineBox)) {
        return [];
    }

    const matches = [];
    const matcher = /\S+/g;
    let match = matcher.exec(rawText);
    while (match) {
        matches.push(match);
        match = matcher.exec(rawText);
    }

    if (matches.length <= 1) {
        const text = trimLookupToken(rawText);
        return text ? [{ text, box: elementBox }] : [];
    }

    const measurableLength = Math.max(1, rawText.length);
    return matches.map((currentMatch) => {
        const text = trimLookupToken(currentMatch[0]);
        if (!text) {
            return null;
        }

        const left = elementBox.x + (elementBox.width * (currentMatch.index / measurableLength));
        const right = elementBox.x + (
            elementBox.width * ((currentMatch.index + currentMatch[0].length) / measurableLength)
        );
        const partLeft = clamp(left, elementBox.x, boxRight(elementBox) - 1);
        const partRight = clamp(Math.max(right, partLeft + 1), partLeft + 1, boxRight(elementBox));

        return {
            text,
            box: {
                x: partLeft,
                y: elementBox.y,
                width: partRight - partLeft,
                height: elementBox.height,
            },
        };
    }).filter(Boolean);
};

const getImageSize = (uri) => new Promise((resolve) => {
    Image.getSize(
        uri,
        (width, height) => resolve({ width, height }),
        () => resolve(null)
    );
});

const getPickedAsset = (result) => {
    if (result?.canceled || result?.type === 'cancel') {
        return null;
    }

    return result?.assets?.[0] ?? result;
};

const normalizeOcrResult = (result) => {
    const imageWidth = Number(result?.imageWidth) || 0;
    const imageHeight = Number(result?.imageHeight) || 0;

    return {
        imageWidth,
        imageHeight,
        text: String(result?.text || ''),
        blocks: Array.isArray(result?.blocks) ? result.blocks : [],
        targets: Array.isArray(result?.targets) ? result.targets : [],
    };
};

const buildLineTargets = (ocrResult) => (
    (ocrResult?.blocks || []).flatMap((block, blockIndex) => (
        (block.lines || []).map((line, lineIndex) => {
            const text = normalizeOcrWhitespace(line?.text);

            if (!text || !hasValidBox(line?.box)) {
                return null;
            }

            return {
                key: `line-${blockIndex}-${lineIndex}`,
                text,
                contextSentence: text,
                box: normalizeBox(line.box),
            };
        }).filter(Boolean)
    ))
);

const createSyntheticWordTargets = (lineText, lineBox) => {
    const tokens = splitLookupTokensWithOffsets(lineText);
    if (!tokens.length || !lineBox?.width) {
        return [];
    }
    if (tokens.length === 1) {
        return [{
            text: tokens[0].text,
            contextSentence: normalizeOcrWhitespace(lineText),
            box: lineBox,
        }];
    }

    const measurableLength = Math.max(1, String(lineText || '').length);
    return tokens.map((token) => {
        const tokenLeft = lineBox.x + (lineBox.width * (token.start / measurableLength));
        const tokenRight = lineBox.x + (lineBox.width * (token.end / measurableLength));
        const left = clamp(tokenLeft, lineBox.x, boxRight(lineBox) - 1);
        const right = clamp(Math.max(tokenRight, left + 1), left + 1, boxRight(lineBox));

        return {
            text: token.text,
            contextSentence: normalizeOcrWhitespace(lineText),
            box: {
                x: left,
                y: lineBox.y,
                width: right - left,
                height: lineBox.height,
            },
        };
    });
};

const createLineTokenTargetsFromParts = (lineText, lineBox, parts) => {
    const tokens = splitLookupTokensWithOffsets(lineText);
    if (tokens.length <= 1) {
        return [];
    }
    if (parts.length === 1) {
        return createSyntheticWordTargets(lineText, lineBox);
    }
    if (!textsLikelyMatch(parts.map((part) => part.text).join(''), lineText)) {
        return [];
    }

    const groups = [];
    let partIndex = 0;
    tokens.forEach((token, tokenIndex) => {
        const targetLength = Math.max(1, lookupContentLength(token.text));
        const startPartIndex = partIndex;
        let consumedLength = 0;

        while (
            partIndex < parts.length
            && (
                consumedLength < targetLength
                || startPartIndex === partIndex
                || tokenIndex === tokens.length - 1
            )
        ) {
            consumedLength += Math.max(1, lookupContentLength(parts[partIndex].text));
            partIndex += 1;
        }

        if (startPartIndex < partIndex) {
            const groupParts = parts.slice(startPartIndex, partIndex);
            groups.push({
                text: token.text,
                box: mergeBoxes(groupParts.map((part) => part.box)),
            });
        }
    });

    if (groups.length !== tokens.length) {
        return [];
    }

    return groups.map((group) => ({
        text: group.text,
        contextSentence: normalizeOcrWhitespace(lineText),
        box: group.box,
    }));
};

const wordGapThreshold = (parts, lineBox) => {
    const totalCharacters = Math.max(
        1,
        parts.reduce((total, part) => total + Math.max(1, lookupContentLength(part.text)), 0)
    );
    const averageCharacterWidth = parts.reduce((total, part) => total + part.box.width, 0) / totalCharacters;
    const baseThreshold = Math.max(3, Math.min(lineBox.height * 0.22, averageCharacterWidth * 0.45));
    const positiveGaps = [];

    for (let index = 1; index < parts.length; index += 1) {
        const gap = parts[index].box.x - boxRight(parts[index - 1].box);
        if (gap > 0) {
            positiveGaps.push(gap);
        }
    }
    positiveGaps.sort((left, right) => left - right);

    if (positiveGaps.length >= 3) {
        const medianGap = positiveGaps[Math.floor(positiveGaps.length / 2)];
        const largestGap = positiveGaps[positiveGaps.length - 1];
        if (largestGap > (medianGap * 2) + 2) {
            return Math.max(3, Math.min(baseThreshold, (medianGap * 1.6) + 1.5));
        }
    }

    return baseThreshold;
};

const createGeometryWordGroups = (parts, lineBox) => {
    if (!parts.length) {
        return [];
    }
    if (parts.length === 1) {
        return [{ text: parts[0].text, box: parts[0].box }];
    }
    if (parts.every((part) => lookupContentLength(part.text) > 1)) {
        return parts.map((part) => ({ text: part.text, box: part.box }));
    }

    const threshold = wordGapThreshold(parts, lineBox);
    const groupedParts = [];
    let currentGroup = [parts[0]];

    parts.slice(1).forEach((part) => {
        const previous = currentGroup[currentGroup.length - 1];
        const gap = part.box.x - boxRight(previous.box);

        if (gap >= threshold) {
            groupedParts.push(currentGroup);
            currentGroup = [part];
        } else {
            currentGroup.push(part);
        }
    });
    groupedParts.push(currentGroup);

    return groupedParts.map((groupParts) => {
        const text = trimLookupToken(groupParts.map((part) => part.text).join(''));
        if (!text) {
            return null;
        }

        return {
            text,
            box: mergeBoxes(groupParts.map((part) => part.box)),
        };
    }).filter(Boolean);
};

const buildWordTargetsForLine = (line) => {
    const lineText = normalizeOcrWhitespace(line?.text);
    const lineBox = hasValidBox(line?.box) ? normalizeBox(line.box) : null;
    const parts = (line?.elements || [])
        .flatMap((element) => splitElementIntoWordParts(element, lineBox))
        .sort((left, right) => (
            left.box.x - right.box.x
            || (left.box.y + (left.box.height / 2)) - (right.box.y + (right.box.height / 2))
        ));
    const effectiveLineBox = lineBox || (parts.length ? mergeBoxes(parts.map((part) => part.box)) : null);

    if (!effectiveLineBox) {
        return [];
    }
    if (!parts.length) {
        return createSyntheticWordTargets(lineText, effectiveLineBox);
    }

    const tokenTargets = createLineTokenTargetsFromParts(lineText, effectiveLineBox, parts);
    if (tokenTargets.length) {
        return tokenTargets;
    }

    const groups = createGeometryWordGroups(parts, effectiveLineBox);
    const contextSentence = groups.length > 1
        ? groups.map((group) => group.text).join(' ')
        : lineText;

    return groups.map((group) => ({
        text: group.text,
        contextSentence,
        box: group.box,
    }));
};

const buildWordTargets = (ocrResult) => (
    (ocrResult?.blocks || []).flatMap((block, blockIndex) => (
        (block.lines || []).flatMap((line, lineIndex) => (
            buildWordTargetsForLine(line).map((target, targetIndex) => ({
                key: `word-${blockIndex}-${lineIndex}-${targetIndex}`,
                ...target,
            }))
        ))
    ))
);

const ScreenshotOcr = ({ navigation, route }) => {
    const { t } = useTranslation();
    const { activeOwnerId } = useLocalOwner();
    const safeAreaInsets = useSafeAreaInsets();
    const { width } = useWindowDimensions();
    const recognitionRunRef = useRef(0);
    const lastFloatingSelectionIdRef = useRef('');
    const [imageUri, setImageUri] = useState('');
    const [imageSize, setImageSize] = useState(null);
    const [ocrResult, setOcrResult] = useState(null);
    const [selectedText, setSelectedText] = useState('');
    const [selectedSentence, setSelectedSentence] = useState('');
    const [selectedBox, setSelectedBox] = useState(null);
    const [selectedSourceBook, setSelectedSourceBook] = useState(OCR_SOURCE_BOOK);
    const [renderedImageLayout, setRenderedImageLayout] = useState(null);
    const [mode, setMode] = useState('lines');
    const [isRecognizing, setIsRecognizing] = useState(false);
    const [error, setError] = useState('');
    const [savedWords, setSavedWords] = useState(null);
    const [floatingStatus, setFloatingStatus] = useState({
        overlayPermissionGranted: false,
        screenCaptureActive: false,
        floatingVisible: false,
        resultOverlayVisible: false,
    });
    const [floatingBusy, setFloatingBusy] = useState('');
    const [floatingMessage, setFloatingMessage] = useState('');
    const [floatingError, setFloatingError] = useState('');

    const mergeFloatingStatus = useCallback((nextStatus = {}) => {
        setFloatingStatus((previous) => ({
            ...previous,
            overlayPermissionGranted: typeof nextStatus.overlayPermissionGranted === 'boolean'
                ? nextStatus.overlayPermissionGranted
                : previous.overlayPermissionGranted,
            screenCaptureActive: typeof nextStatus.screenCaptureActive === 'boolean'
                ? nextStatus.screenCaptureActive
                : previous.screenCaptureActive,
            floatingVisible: typeof nextStatus.floatingVisible === 'boolean'
                ? nextStatus.floatingVisible
                : previous.floatingVisible,
            resultOverlayVisible: typeof nextStatus.resultOverlayVisible === 'boolean'
                ? nextStatus.resultOverlayVisible
                : previous.resultOverlayVisible,
        }));
    }, []);

    useFocusEffect(
        useCallback(() => {
            let isActive = true;
            const overlayStatusSubscription = Platform.OS === 'android'
                ? addOverlayStatusListener((status) => {
                    mergeFloatingStatus(status);
                    if (status?.status) {
                        setFloatingMessage(String(status.status).replace(/_/g, ' '));
                    }
                })
                : null;
            const overlayErrorSubscription = Platform.OS === 'android'
                ? addOverlayErrorListener((status) => {
                    setFloatingError(status?.message || t('ocr.failedFloating'));
                })
                : null;
            const ocrResultSubscription = Platform.OS === 'android'
                ? addOcrResultListener((result) => {
                    const normalizedResult = normalizeOcrResult(result);
                    const targetCount = normalizedResult.targets.length
                        || buildWordTargets(normalizedResult).length
                        || buildLineTargets(normalizedResult).length;
                    setFloatingMessage(t('ocr.foundItems', {
                        count: targetCount,
                        noun: targetCount === 1 ? t('ocr.itemSingular') : t('ocr.itemPlural'),
                    }));
                })
                : null;

            if (Platform.OS === 'android') {
                mergeFloatingStatus({
                    overlayPermissionGranted: isOverlayPermissionGranted(),
                    screenCaptureActive: isScreenCaptureActive(),
                });
            }

            getSavedWords({ ownerId: activeOwnerId })
                .then((words) => {
                    if (isActive) {
                        setSavedWords(words);
                    }
                })
                .catch((loadError) => {
                    console.error('[ScreenshotOcr] Failed to load saved words:', loadError);
                    if (isActive) {
                        setSavedWords([]);
                    }
                });

            return () => {
                isActive = false;
                overlayStatusSubscription?.remove();
                overlayErrorSubscription?.remove();
                ocrResultSubscription?.remove();
            };
        }, [activeOwnerId, mergeFloatingStatus, t])
    );

    useEffect(() => {
        const selection = route?.params?.floatingSelection;
        const selectedFloatingText = String(selection?.selectedText || '').trim();

        if (!selectedFloatingText) {
            return;
        }

        const selectionId = String(
            selection?.selectionId
            || `${selectedFloatingText}:${selection?.selectedLineText || ''}`
        );

        if (selectionId === lastFloatingSelectionIdRef.current) {
            return;
        }

        lastFloatingSelectionIdRef.current = selectionId;
        setSelectedText(selectedFloatingText);
        setSelectedSentence(String(selection?.selectedLineText || selectedFloatingText).trim());
        setSelectedBox(selection?.selectedBox || null);
        setSelectedSourceBook({
            ...FLOATING_OCR_SOURCE_BOOK,
            title: selection?.sourceBookTitle || FLOATING_OCR_SOURCE_BOOK.title,
        });
        setFloatingMessage(t('ocr.selectedFloating'));
        navigation?.setParams?.({ floatingSelection: undefined });
    }, [navigation, route?.params?.floatingSelection, t]);

    const imageMetrics = useMemo(() => {
        if (ocrResult?.imageWidth && ocrResult?.imageHeight) {
            return {
                width: ocrResult.imageWidth,
                height: ocrResult.imageHeight,
            };
        }

        return imageSize;
    }, [imageSize, ocrResult]);

    const aspectRatio = imageMetrics?.width && imageMetrics?.height
        ? imageMetrics.width / imageMetrics.height
        : 9 / 16;
    const availableImageWidth = Math.max(1, width - (insets.screenHorizontal * 2));
    const imageFrameWidth = Math.min(
        availableImageWidth,
        layout.screenMaxWidth - (insets.screenHorizontal * 2)
    );
    const imageFrameHeight = imageFrameWidth / aspectRatio;
    const lineTargets = useMemo(() => buildLineTargets(ocrResult), [ocrResult]);
    const wordTargets = useMemo(() => buildWordTargets(ocrResult), [ocrResult]);
    const activeTargets = mode === 'words' ? wordTargets : lineTargets;
    const hasRecognizedText = !!ocrResult && (lineTargets.length > 0 || wordTargets.length > 0);
    const canRunOcr = !!imageUri && !isRecognizing;

    const runRecognition = useCallback(async (uri) => {
        if (!uri) {
            return;
        }

        const runId = recognitionRunRef.current + 1;
        recognitionRunRef.current = runId;
        setIsRecognizing(true);
        setError('');
        setSelectedText('');
        setSelectedSentence('');
        setSelectedBox(null);
        setSelectedSourceBook(OCR_SOURCE_BOOK);

        try {
            const result = normalizeOcrResult(await recognizeImage(uri));

            if (recognitionRunRef.current !== runId) {
                return;
            }

            setOcrResult(result);
            if (result.imageWidth > 0 && result.imageHeight > 0) {
                setImageSize({ width: result.imageWidth, height: result.imageHeight });
            }
            if ((result.blocks || []).length === 0) {
                setError(t('ocr.noKoreanText'));
            }
        } catch (recognitionError) {
            console.error('[ScreenshotOcr] OCR failed:', recognitionError);
            if (recognitionRunRef.current === runId) {
                setOcrResult(null);
                setError(recognitionError?.message || t('ocr.failedImage'));
            }
        } finally {
            if (recognitionRunRef.current === runId) {
                setIsRecognizing(false);
            }
        }
    }, [t]);

    const handlePickImage = useCallback(async () => {
        try {
            const result = await DocumentPicker.getDocumentAsync({
                type: ['image/png', 'image/jpeg'],
                copyToCacheDirectory: true,
            });
            const asset = getPickedAsset(result);

            if (!asset?.uri) {
                return;
            }

            setImageUri(asset.uri);
            setOcrResult(null);
            setRenderedImageLayout(null);
            setError('');
            setSelectedText('');
            setSelectedSentence('');
            setSelectedBox(null);
            setSelectedSourceBook(OCR_SOURCE_BOOK);

            const pickedImageSize = await getImageSize(asset.uri);
            if (pickedImageSize) {
                setImageSize(pickedImageSize);
            }

            await runRecognition(asset.uri);
        } catch (pickError) {
            console.error('[ScreenshotOcr] Failed to pick image:', pickError);
            setError(pickError?.message || t('ocr.openImageFailed'));
        }
    }, [runRecognition, t]);

    const handleRerunOcr = useCallback(() => {
        if (canRunOcr) {
            runRecognition(imageUri);
        }
    }, [canRunOcr, imageUri, runRecognition]);

    const handleClear = useCallback(() => {
        recognitionRunRef.current += 1;
        setImageUri('');
        setImageSize(null);
        setOcrResult(null);
        setSelectedText('');
        setSelectedSentence('');
        setSelectedBox(null);
        setSelectedSourceBook(OCR_SOURCE_BOOK);
        setRenderedImageLayout(null);
        setIsRecognizing(false);
        setError('');
        setFloatingError('');
        setFloatingMessage('');
    }, []);

    const selectTarget = useCallback((target) => {
        setSelectedText(target.text);
        setSelectedSentence(target.contextSentence || target.text);
        setSelectedBox(target);
        setSelectedSourceBook(OCR_SOURCE_BOOK);
    }, []);

    const closeLookup = useCallback(() => {
        setSelectedText('');
        setSelectedSentence('');
        setSelectedBox(null);
        setSelectedSourceBook(OCR_SOURCE_BOOK);
    }, []);

    const handleWordSave = useCallback((word, options = {}) => {
        const surface = options.includeSurface === false ? '' : selectedText?.trim();
        setSavedWords((previous) => uniqueTerms([...(previous ?? []), word, surface]));
    }, [selectedText]);

    const handleWordUnsave = useCallback((word, options = {}) => {
        const surface = options.includeSurface === false ? '' : selectedText?.trim();
        setSavedWords((previous) => (
            previous ?? []
        ).filter((term) => term !== word && term !== surface));
    }, [selectedText]);

    const runFloatingAction = useCallback(async (busyLabel, action) => {
        if (Platform.OS !== 'android') {
            setFloatingError(t('ocr.androidOnly'));
            return null;
        }

        setFloatingBusy(busyLabel);
        setFloatingError('');

        try {
            return await action();
        } catch (floatingActionError) {
            console.error('[ScreenshotOcr] Floating OCR action failed:', floatingActionError);
            setFloatingError(floatingActionError?.message || t('ocr.failedFloating'));
            return null;
        } finally {
            setFloatingBusy('');
        }
    }, [t]);

    const handleCheckFloatingStatus = useCallback(() => {
        mergeFloatingStatus({
            overlayPermissionGranted: isOverlayPermissionGranted(),
            screenCaptureActive: isScreenCaptureActive(),
        });
        setFloatingError('');
        setFloatingMessage(t('ocr.statusRefreshed'));
    }, [mergeFloatingStatus, t]);

    const handleRequestOverlayPermission = useCallback(async () => {
        const result = await runFloatingAction('overlay', requestOverlayPermission);
        if (result) {
            mergeFloatingStatus({ overlayPermissionGranted: !!result.granted });
            setFloatingMessage(result.granted ? t('ocr.overlayGranted') : t('ocr.overlayDenied'));
        }
    }, [mergeFloatingStatus, runFloatingAction, t]);

    const handleRequestScreenCapture = useCallback(async () => {
        const result = await runFloatingAction('capture', requestScreenCapture);
        if (result) {
            mergeFloatingStatus({ screenCaptureActive: !!result.active });
            setFloatingMessage(result.granted ? t('ocr.captureActive') : t('ocr.captureDenied'));
        }
    }, [mergeFloatingStatus, runFloatingAction, t]);

    const handleStartFloatingWidget = useCallback(async () => {
        const result = await runFloatingAction('start', startFloatingWidget);
        if (result) {
            mergeFloatingStatus({ floatingVisible: !!result.visible });
            setFloatingMessage(result.visible ? t('ocr.bubbleStarted') : t('ocr.bubbleFailed'));
        }
    }, [mergeFloatingStatus, runFloatingAction, t]);

    const handleStopFloatingWidget = useCallback(async () => {
        const result = await runFloatingAction('stop', stopFloatingWidget);
        if (result) {
            mergeFloatingStatus({ floatingVisible: !!result.visible, resultOverlayVisible: false });
            setFloatingMessage(t('ocr.bubbleStopped'));
        }
    }, [mergeFloatingStatus, runFloatingAction, t]);

    const handleAnalyzeCurrentScreen = useCallback(async () => {
        const result = await runFloatingAction('analyze', analyzeCurrentScreen);
        if (result) {
            const normalizedResult = normalizeOcrResult(result);
            const targetCount = normalizedResult.targets.length
                || buildWordTargets(normalizedResult).length
                || buildLineTargets(normalizedResult).length;
            setFloatingMessage(t('ocr.testFoundItems', {
                count: targetCount,
                noun: targetCount === 1 ? t('ocr.itemSingular') : t('ocr.itemPlural'),
            }));
        }
    }, [runFloatingAction, t]);

    const renderTargetBox = (target) => {
        if (!renderedImageLayout || !imageMetrics?.width || !imageMetrics?.height) {
            return null;
        }

        const scaleX = renderedImageLayout.width / imageMetrics.width;
        const scaleY = renderedImageLayout.height / imageMetrics.height;
        const isSelected = selectedBox?.key === target.key;

        return (
            <Pressable
                key={target.key}
                accessibilityRole="button"
                accessibilityLabel={t('ocr.lookup', { text: target.text })}
                hitSlop={{ top: 4, right: 4, bottom: 4, left: 4 }}
                onPress={() => selectTarget(target)}
                style={({ pressed }) => [
                    styles.ocrBox,
                    {
                        left: target.box.x * scaleX,
                        top: target.box.y * scaleY,
                        width: target.box.width * scaleX,
                        height: target.box.height * scaleY,
                    },
                    isSelected && styles.ocrBoxSelected,
                    pressed && styles.ocrBoxPressed,
                ]}
            />
        );
    };

    return (
        <View style={styles.root}>
            <View style={[styles.topBar, { paddingTop: safeAreaInsets.top + spacing.xs }]}>
                <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={t('ocr.back')}
                    activeOpacity={0.78}
                    onPress={() => navigation?.goBack()}
                    style={styles.iconButton}
                >
                    <Feather name="chevron-left" size={30} color={colors.textMuted} />
                </TouchableOpacity>

                <View style={styles.titleBlock}>
                    <Text style={styles.eyebrow}>LAB</Text>
                    <Text style={styles.title} numberOfLines={1}>{t('ocr.screenshotTitle')}</Text>
                </View>

                <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={t('ocr.clear')}
                    activeOpacity={0.78}
                    onPress={handleClear}
                    disabled={!imageUri && !ocrResult && !error}
                    style={[styles.iconButton, !imageUri && !ocrResult && !error && styles.iconButtonDisabled]}
                >
                    <Feather name="x" size={24} color={colors.textMuted} />
                </TouchableOpacity>
            </View>

            <View style={styles.toolbar}>
                <TouchableOpacity
                    accessibilityRole="button"
                    activeOpacity={0.86}
                    onPress={handlePickImage}
                    style={styles.primaryAction}
                >
                    <Feather name="image" size={17} color={colors.white} />
                    <Text style={styles.primaryActionText}>{t('ocr.pickImage')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    accessibilityRole="button"
                    activeOpacity={0.82}
                    disabled={!canRunOcr}
                    onPress={handleRerunOcr}
                    style={[styles.secondaryAction, !canRunOcr && styles.actionDisabled]}
                >
                    {isRecognizing ? (
                        <ActivityIndicator size="small" color={colors.textMuted} />
                    ) : (
                        <Feather name="refresh-cw" size={16} color={colors.textMuted} />
                    )}
                    <Text style={styles.secondaryActionText}>OCR</Text>
                </TouchableOpacity>

                <View style={styles.segmentedControl}>
                    {OCR_MODES.map((option) => {
                        const isActive = mode === option.id;

                        return (
                            <TouchableOpacity
                                key={option.id}
                                accessibilityRole="button"
                                activeOpacity={0.82}
                                onPress={() => setMode(option.id)}
                                style={[
                                    styles.segmentButton,
                                    isActive && styles.segmentButtonActive,
                                ]}
                            >
                                <Text style={[
                                    styles.segmentButtonText,
                                    isActive && styles.segmentButtonTextActive,
                                ]}>
                                    {t(option.labelKey)}
                                </Text>
                            </TouchableOpacity>
                        );
                    })}
                </View>
            </View>

            {Platform.OS === 'android' ? (
                <View style={styles.floatingPanel}>
                    <View style={styles.floatingHeader}>
                        <View>
                            <Text style={styles.floatingTitle}>{t('ocr.floatingTitle')}</Text>
                            <Text style={styles.floatingStatusText} numberOfLines={1}>
                                {floatingMessage || t('ocr.ready')}
                            </Text>
                        </View>

                        <View style={styles.floatingChips}>
                            <View style={[styles.statusChip, floatingStatus.overlayPermissionGranted && styles.statusChipActive]}>
                                <Text style={[styles.statusChipText, floatingStatus.overlayPermissionGranted && styles.statusChipTextActive]}>
                                    {t('ocr.overlay')}
                                </Text>
                            </View>
                            <View style={[styles.statusChip, floatingStatus.screenCaptureActive && styles.statusChipActive]}>
                                <Text style={[styles.statusChipText, floatingStatus.screenCaptureActive && styles.statusChipTextActive]}>
                                    {t('ocr.capture')}
                                </Text>
                            </View>
                            <View style={[styles.statusChip, floatingStatus.floatingVisible && styles.statusChipActive]}>
                                <Text style={[styles.statusChipText, floatingStatus.floatingVisible && styles.statusChipTextActive]}>
                                    {t('ocr.bubble')}
                                </Text>
                            </View>
                        </View>
                    </View>

                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.floatingActions}
                    >
                        <TouchableOpacity
                            accessibilityRole="button"
                            activeOpacity={0.82}
                            onPress={handleCheckFloatingStatus}
                            style={styles.floatingAction}
                        >
                            <Feather name="check-circle" size={15} color={colors.textMuted} />
                            <Text style={styles.floatingActionText}>{t('ocr.check')}</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            accessibilityRole="button"
                            activeOpacity={0.82}
                            disabled={floatingBusy === 'overlay'}
                            onPress={handleRequestOverlayPermission}
                            style={[styles.floatingAction, floatingBusy === 'overlay' && styles.actionDisabled]}
                        >
                            {floatingBusy === 'overlay' ? (
                                <ActivityIndicator size="small" color={colors.textMuted} />
                            ) : (
                                <Feather name="shield" size={15} color={colors.textMuted} />
                            )}
                            <Text style={styles.floatingActionText}>{t('ocr.overlay')}</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            accessibilityRole="button"
                            activeOpacity={0.82}
                            disabled={floatingBusy === 'capture'}
                            onPress={handleRequestScreenCapture}
                            style={[styles.floatingAction, floatingBusy === 'capture' && styles.actionDisabled]}
                        >
                            {floatingBusy === 'capture' ? (
                                <ActivityIndicator size="small" color={colors.textMuted} />
                            ) : (
                                <Feather name="monitor" size={15} color={colors.textMuted} />
                            )}
                            <Text style={styles.floatingActionText}>{t('ocr.capture')}</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            accessibilityRole="button"
                            activeOpacity={0.82}
                            disabled={floatingBusy === 'start'}
                            onPress={handleStartFloatingWidget}
                            style={[styles.floatingAction, floatingBusy === 'start' && styles.actionDisabled]}
                        >
                            {floatingBusy === 'start' ? (
                                <ActivityIndicator size="small" color={colors.textMuted} />
                            ) : (
                                <Feather name="play-circle" size={15} color={colors.textMuted} />
                            )}
                            <Text style={styles.floatingActionText}>{t('ocr.start')}</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            accessibilityRole="button"
                            activeOpacity={0.82}
                            disabled={floatingBusy === 'stop'}
                            onPress={handleStopFloatingWidget}
                            style={[styles.floatingAction, floatingBusy === 'stop' && styles.actionDisabled]}
                        >
                            {floatingBusy === 'stop' ? (
                                <ActivityIndicator size="small" color={colors.textMuted} />
                            ) : (
                                <Feather name="square" size={15} color={colors.textMuted} />
                            )}
                            <Text style={styles.floatingActionText}>{t('ocr.stop')}</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            accessibilityRole="button"
                            activeOpacity={0.82}
                            disabled={floatingBusy === 'analyze'}
                            onPress={handleAnalyzeCurrentScreen}
                            style={[styles.floatingAction, floatingBusy === 'analyze' && styles.actionDisabled]}
                        >
                            {floatingBusy === 'analyze' ? (
                                <ActivityIndicator size="small" color={colors.textMuted} />
                            ) : (
                                <Feather name="zap" size={15} color={colors.textMuted} />
                            )}
                            <Text style={styles.floatingActionText}>{t('ocr.test')}</Text>
                        </TouchableOpacity>
                    </ScrollView>

                    {floatingError ? (
                        <Text style={styles.floatingErrorText} numberOfLines={2}>{floatingError}</Text>
                    ) : null}
                </View>
            ) : null}

            <View style={styles.content}>
                {!imageUri ? (
                    <View style={styles.emptyState}>
                        <MaterialIcons name="document-scanner" size={34} color={colors.textSubtle} />
                        <Text style={styles.emptyTitle}>{t('ocr.selectScreenshot')}</Text>
                    </View>
                ) : (
                    <ScrollView
                        contentContainerStyle={[
                            styles.imageScrollContent,
                            selectedText ? { paddingBottom: 228 + safeAreaInsets.bottom } : null,
                        ]}
                        showsVerticalScrollIndicator={false}
                    >
                        <View
                            onLayout={(event) => setRenderedImageLayout(event.nativeEvent.layout)}
                            style={[
                                styles.imageFrame,
                                {
                                    width: imageFrameWidth,
                                    height: imageFrameHeight,
                                },
                            ]}
                        >
                            <Image
                                source={{ uri: imageUri }}
                                resizeMode="stretch"
                                style={StyleSheet.absoluteFill}
                            />

                            {activeTargets.map(renderTargetBox)}

                            {isRecognizing ? (
                                <View style={styles.recognitionOverlay}>
                                    <ActivityIndicator size="small" color={colors.white} />
                                    <Text style={styles.recognitionText}>{t('ocr.recognizing')}</Text>
                                </View>
                            ) : null}
                        </View>

                        {error ? (
                            <Text style={styles.errorText}>{error}</Text>
                        ) : null}

                        {ocrResult && !hasRecognizedText && !isRecognizing && !error ? (
                            <Text style={styles.emptyOcrText}>{t('ocr.noTextBlocks')}</Text>
                        ) : null}
                    </ScrollView>
                )}
            </View>

            <View
                pointerEvents="box-none"
                style={[
                    styles.lookupLayer,
                    { paddingBottom: Math.max(6, safeAreaInsets.bottom + 6) },
                ]}
            >
                {selectedText ? (
                    <Pressable style={styles.lookupDismissZone} onPress={closeLookup} />
                ) : null}

                <TopSection
                    highlightedWord={selectedText}
                    sourceSentence={selectedSentence}
                    isNativeSelection={false}
                    isDarkMode={false}
                    onClose={closeLookup}
                    onWordSave={handleWordSave}
                    onWordUnsave={handleWordUnsave}
                    currentBook={null}
                    sourceBook={selectedSourceBook}
                    savedWords={savedWords ?? []}
                />
            </View>

            {Platform.OS !== 'android' ? (
                <View style={styles.platformBadge}>
                    <Text style={styles.platformBadgeText}>{t('ocr.androidOnlyBadge')}</Text>
                </View>
            ) : null}
        </View>
    );
};

const styles = StyleSheet.create({
    root: {
        flex: 1,
        backgroundColor: colors.backgroundWarm,
    },
    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingHorizontal: insets.screenHorizontal,
        paddingBottom: spacing.sm,
    },
    iconButton: {
        width: 42,
        height: 42,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 21,
    },
    iconButtonDisabled: {
        opacity: 0.36,
    },
    titleBlock: {
        flex: 1,
        minWidth: 0,
    },
    eyebrow: {
        ...textStyles.eyebrow,
        color: colors.accentStrong,
        letterSpacing: 0,
    },
    title: {
        ...textStyles.sectionTitle,
        fontSize: 22,
        lineHeight: 28,
        color: colors.text,
        letterSpacing: 0,
    },
    toolbar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingHorizontal: insets.screenHorizontal,
        paddingBottom: spacing.md,
    },
    primaryAction: {
        minHeight: 42,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        paddingHorizontal: spacing.md,
        borderRadius: radii.xs,
        backgroundColor: colors.accentStrong,
    },
    primaryActionText: {
        ...textStyles.caption,
        fontFamily: fontFamilies.sansBold,
        color: colors.white,
        letterSpacing: 0,
    },
    secondaryAction: {
        minHeight: 42,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        paddingHorizontal: spacing.sm,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radii.xs,
        backgroundColor: colors.surfaceElevated,
    },
    secondaryActionText: {
        ...textStyles.caption,
        fontFamily: fontFamilies.sansBold,
        color: colors.textMuted,
        letterSpacing: 0,
    },
    actionDisabled: {
        opacity: 0.45,
    },
    segmentedControl: {
        flex: 1,
        minWidth: 124,
        minHeight: 42,
        flexDirection: 'row',
        padding: 3,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radii.xs,
        backgroundColor: colors.surfaceElevated,
    },
    segmentButton: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 6,
    },
    segmentButtonActive: {
        backgroundColor: colors.accentSoft,
    },
    segmentButtonText: {
        ...textStyles.caption,
        fontFamily: fontFamilies.sansBold,
        color: colors.textMuted,
        letterSpacing: 0,
    },
    segmentButtonTextActive: {
        color: colors.accentStrong,
    },
    floatingPanel: {
        marginHorizontal: insets.screenHorizontal,
        marginBottom: spacing.md,
        padding: spacing.sm,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radii.xs,
        backgroundColor: colors.surfaceElevated,
    },
    floatingHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.sm,
        marginBottom: spacing.sm,
    },
    floatingTitle: {
        ...textStyles.caption,
        fontFamily: fontFamilies.sansBold,
        color: colors.text,
        letterSpacing: 0,
    },
    floatingStatusText: {
        ...textStyles.caption,
        maxWidth: 168,
        color: colors.textMuted,
        letterSpacing: 0,
    },
    floatingChips: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        flexShrink: 0,
    },
    statusChip: {
        minHeight: 24,
        justifyContent: 'center',
        paddingHorizontal: 7,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radii.xs,
        backgroundColor: colors.surfaceMuted,
    },
    statusChipActive: {
        borderColor: colors.success,
        backgroundColor: 'rgba(47, 125, 76, 0.12)',
    },
    statusChipText: {
        ...textStyles.caption,
        fontSize: 11,
        lineHeight: 14,
        fontFamily: fontFamilies.sansBold,
        color: colors.textSubtle,
        letterSpacing: 0,
    },
    statusChipTextActive: {
        color: colors.success,
    },
    floatingActions: {
        gap: spacing.xs,
        paddingRight: spacing.sm,
    },
    floatingAction: {
        minHeight: 36,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        paddingHorizontal: spacing.sm,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radii.xs,
        backgroundColor: colors.surface,
    },
    floatingActionText: {
        ...textStyles.caption,
        fontFamily: fontFamilies.sansBold,
        color: colors.textMuted,
        letterSpacing: 0,
    },
    floatingErrorText: {
        ...textStyles.caption,
        marginTop: spacing.xs,
        color: colors.danger,
        letterSpacing: 0,
    },
    content: {
        flex: 1,
        minHeight: 0,
    },
    emptyState: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        paddingHorizontal: spacing.xl,
    },
    emptyTitle: {
        ...textStyles.sectionTitle,
        fontSize: 18,
        lineHeight: 24,
        color: colors.textMuted,
        textAlign: 'center',
        letterSpacing: 0,
    },
    imageScrollContent: {
        alignItems: 'center',
        paddingHorizontal: insets.screenHorizontal,
        paddingBottom: spacing.xl,
    },
    imageFrame: {
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radii.xs,
        backgroundColor: colors.surfaceMuted,
    },
    ocrBox: {
        position: 'absolute',
        borderWidth: 1.5,
        borderColor: 'rgba(200, 125, 0, 0.78)',
        backgroundColor: 'rgba(200, 125, 0, 0.12)',
    },
    ocrBoxSelected: {
        borderColor: colors.success,
        backgroundColor: 'rgba(47, 125, 76, 0.18)',
    },
    ocrBoxPressed: {
        backgroundColor: 'rgba(47, 125, 76, 0.28)',
    },
    recognitionOverlay: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        backgroundColor: 'rgba(26, 26, 26, 0.42)',
    },
    recognitionText: {
        ...textStyles.body,
        fontFamily: fontFamilies.sansBold,
        color: colors.white,
        letterSpacing: 0,
    },
    errorText: {
        ...textStyles.body,
        marginTop: spacing.md,
        color: colors.danger,
        textAlign: 'center',
        letterSpacing: 0,
    },
    emptyOcrText: {
        ...textStyles.body,
        marginTop: spacing.md,
        color: colors.textMuted,
        textAlign: 'center',
        letterSpacing: 0,
    },
    lookupLayer: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
    },
    lookupDismissZone: {
        ...StyleSheet.absoluteFillObject,
    },
    platformBadge: {
        position: 'absolute',
        right: spacing.md,
        bottom: spacing.md,
        paddingHorizontal: spacing.sm,
        paddingVertical: 5,
        borderRadius: radii.xs,
        backgroundColor: colors.surfaceStrong,
    },
    platformBadgeText: {
        ...textStyles.caption,
        fontFamily: fontFamilies.sansBold,
        color: colors.textMuted,
        letterSpacing: 0,
    },
});

export default ScreenshotOcr;
